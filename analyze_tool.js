// Builds individual scores and an aggregate class diagnostic report.

let allResults = [];
let processedFileResults = [];
let classReport = null;
let referenceFileNameRoot = "";
let isProcessing = false;
let renderedReportPanels = new Set();

const REPORT_PAGE_SIZE = 100;
const DOMINANT_PATTERN_MIN_COUNT = 2;
const DOMINANT_REORDER_MIN_RATE = 30;

const reportPageState = {
    elements: 1,
    relationships: 1,
    distractors: 1,
    omitted: 1,
    unknown: 1,
    duplicates: 1,
    students: 1
};

const reportSortState = {
    elements: { key: "affectedRate", direction: "desc" },
    relationships: { key: "reversalRate", direction: "desc" },
    distractors: { key: "retentionRate", direction: "desc" },
    omitted: { key: "rate", direction: "desc" },
    unknown: { key: "rate", direction: "desc" },
    duplicates: { key: "rate", direction: "desc" },
    students: { key: "filename", direction: "asc" }
};

const SCORE_VARIANT_SUFFIX = "labeled_full_sequence";

const ADDITIONAL_SCORE_METHODS = [
    { label: "Positional", rawField: "positional_raw", normField: "positional_norm", referenceField: "positional_best_reference_id" },
    { label: "Adjacent-Pair", rawField: "adjacent_pair_raw", totalField: "adjacent_pair_total", normField: "adjacent_pair_norm", referenceField: "adjacent_pair_best_reference_id" },
    { label: "Pairwise Relative-Order", rawField: "pairwise_relative_order_raw", totalField: "pairwise_relative_order_total", normField: "pairwise_relative_order_norm", referenceField: "pairwise_relative_order_best_reference_id" },
    { label: "Hybrid Local-Global", normField: "hybrid_local_global_norm", referenceField: "hybrid_local_global_best_reference_id" }
];
const ADDITIONAL_SCORE_EXPORT_FIELDS = ADDITIONAL_SCORE_METHODS.flatMap(method => {
    const fields = [
        `${method.normField}_${SCORE_VARIANT_SUFFIX}`,
        `${method.referenceField}_${SCORE_VARIANT_SUFFIX}`
    ];
    if (method.rawField) fields.unshift(`${method.rawField}_${SCORE_VARIANT_SUFFIX}`);
    if (method.totalField) fields.splice(1, 0, `${method.totalField}_${SCORE_VARIANT_SUFFIX}`);
    return fields;
});
document.addEventListener("DOMContentLoaded", function() {
    SequencerUI.setupDropZone({
        dropZoneId: "referenceFileDropZone",
        inputId: "reference-file",
        multiple: true,
        pickerId: "sequencer-reference"
    });
    SequencerUI.setupDropZone({
        dropZoneId: "studentFilesDropZone",
        inputId: "sequence-files",
        multiple: true,
        pickerId: "sequencer-students"
    });

    document.getElementById("reference-file").addEventListener("change", function() {
        clearAnalysisResults("Reference file selection changed. Previous report cleared.");
    });
    document.getElementById("sequence-files").addEventListener("change", function() {
        clearAnalysisResults("Student file selection changed. Previous report cleared.");
    });
    document.getElementById("show-full-text").addEventListener("change", event => {
        document.getElementById("class-report").classList.toggle("show-full-text", event.target.checked);
    });
    document.getElementById("relationship-element-filter").addEventListener("change", renderRelationships);
    document.getElementById("relationship-errors-only").addEventListener("change", renderRelationships);
    document.getElementById("relationship-type-filter").addEventListener("change", event => {
        reportSortState.relationships = event.target.value === "immediate"
            ? { key: "immediateCorrectRate", direction: "asc" }
            : { key: "reversalRate", direction: "desc" };
        renderRelationships();
    });

    const report = document.getElementById("class-report");
    report.addEventListener("click", event => {
        const sortButton = event.target.closest("[data-sort-view]");

        if (sortButton) {
            updateSort(sortButton.dataset.sortView, sortButton.dataset.sortKey);
            return;
        }

        const pageButton = event.target.closest("[data-page-view]");

        if (pageButton) {
            updatePage(pageButton.dataset.pageView, Number(pageButton.dataset.page));
        }
    });

    const tabs = Array.from(document.querySelectorAll("[data-report-tab]"));
    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activateReportTab(tab.dataset.reportTab));
        tab.addEventListener("keydown", event => {
            let nextIndex = index;

            if (event.key === "ArrowRight") {
                nextIndex = (index + 1) % tabs.length;
            } else if (event.key === "ArrowLeft") {
                nextIndex = (index - 1 + tabs.length) % tabs.length;
            } else if (event.key === "Home") {
                nextIndex = 0;
            } else if (event.key === "End") {
                nextIndex = tabs.length - 1;
            } else {
                return;
            }

            event.preventDefault();
            activateReportTab(tabs[nextIndex].dataset.reportTab);
            tabs[nextIndex].focus();
        });
    });

    updateAnalyzeButtons();
});

async function processFiles() {
    if (isProcessing) {
        return;
    }

    const referenceFiles = SequencerUI.getSelectedFiles("reference-file");
    const sequenceFiles = SequencerUI.getSelectedFiles("sequence-files");

    if (referenceFiles.length === 0 || sequenceFiles.length === 0) {
        alert("Please select the reference and student files before generating a report.");
        return;
    }

    setProcessingState(true);
    resetReportData();
    const reportSection = document.getElementById("class-report");
    reportSection.setAttribute("aria-busy", "true");
    announceAnalysisStatus(`Processing ${sequenceFiles.length} student ${sequenceFiles.length === 1 ? "file" : "files"}.`);

    try {
        const referenceBundle = await loadReferenceBundle(referenceFiles);
        referenceFileNameRoot = referenceBundle.reportNameRoot;

        processedFileResults = await Promise.all(sequenceFiles.map(file => processStudentFile(file, referenceBundle.scoringReferenceData)));
        const validResults = processedFileResults.filter(fileResult => !fileResult.error);
        classReport = SequencerCore.analyzeClass(
            referenceBundle.diagnosticReferenceData,
            validResults.map(fileResult => fileResult.sequence)
        );
        classReport.referenceFiles = referenceBundle.referenceFiles;
        classReport.scoringReferenceCount = referenceBundle.scoringReferenceCount;
        classReport.diagnosticReferenceFileName = referenceBundle.diagnosticReferenceFileName;
        classReport.diagnosticReferenceId = referenceBundle.diagnosticReferenceId;
        allResults = processedFileResults.map(convertResultToRow);
        renderClassReport();

        const errorCount = processedFileResults.length - validResults.length;
        announceAnalysisStatus(
            `Class report generated from ${validResults.length} valid ${validResults.length === 1 ? "submission" : "submissions"}`
            + `${errorCount > 0 ? `. ${errorCount} ${errorCount === 1 ? "file could" : "files could"} not be analyzed` : ""}.`
        );
    } catch (error) {
        console.error("Error processing files:", error);
        resetReportData();
        announceAnalysisStatus(`Processing failed. ${error.message}`);
        alert(error.message);
    } finally {
        reportSection.setAttribute("aria-busy", "false");
        setProcessingState(false);
    }
}

async function processStudentFile(file, referenceData) {
    try {
        const sequence = SequencerCore.normalizeStudentSequence(
            SequencerCore.parseJson(await file.text(), file.name)
        );
        const result = SequencerCore.analyzeSequence(referenceData, sequence);

        return {
            filename: file.name,
            sequence,
            result
        };
    } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
        return {
            filename: file.name,
            error: error.message
        };
    }
}

async function loadReferenceBundle(referenceFiles) {
    const references = [];

    for (const file of referenceFiles) {
        const root = getReferenceFileNameRoot(file.name);
        const data = SequencerCore.normalizeReferenceData(
            SequencerCore.parseJson(await file.text(), file.name)
        );

        references.push({
            filename: file.name,
            root,
            data
        });
    }

    validateReferenceBundle(references);

    const diagnosticReference = references[0];
    const referenceSequences = [];

    references.forEach(reference => {
        reference.data.referenceSequences.forEach((variant, index) => {
            referenceSequences.push({
                id: createUploadedReferenceId(reference.root, variant.id, reference.data.referenceSequences.length, index),
                sequence: variant.sequence
            });
        });
    });

    const scoringReferenceData = SequencerCore.normalizeReferenceData({
        startingElements: diagnosticReference.data.startingElements,
        endingElements: diagnosticReference.data.endingElements,
        distractors: diagnosticReference.data.distractors,
        referenceSequences
    });

    return {
        diagnosticReferenceData: diagnosticReference.data,
        diagnosticReferenceFileName: diagnosticReference.filename,
        diagnosticReferenceId: referenceSequences[0]?.id || diagnosticReference.root,
        scoringReferenceData,
        scoringReferenceCount: referenceSequences.length,
        referenceFiles: references.map(reference => ({
            filename: reference.filename,
            root: reference.root,
            sequenceCount: reference.data.referenceSequences.length
        })),
        reportNameRoot: references.length === 1
            ? diagnosticReference.root
            : `${diagnosticReference.root}_plus_${references.length - 1}_references`
    };
}

function createUploadedReferenceId(root, variantId, variantCount, index) {
    if (variantCount === 1 || !variantId || variantId === "reference_1") {
        return root;
    }

    return `${root}:${variantId || `reference_${index + 1}`}`;
}

function validateReferenceBundle(references) {
    if (references.length === 0) {
        throw new Error("Select at least one reference file.");
    }

    const diagnostic = references[0].data;
    const expectedItems = getReferenceItemSet(diagnostic);
    const expectedDistractors = getStringSet(diagnostic.distractors);

    references.forEach(reference => {
        const data = reference.data;

        if (!arraysEqual(data.startingElements, diagnostic.startingElements)) {
            throw new Error(`${reference.filename} has different fixed starting elements than ${references[0].filename}.`);
        }

        if (!arraysEqual(data.endingElements, diagnostic.endingElements)) {
            throw new Error(`${reference.filename} has different fixed ending elements than ${references[0].filename}.`);
        }

        if (!setsEqual(getStringSet(data.distractors), expectedDistractors)) {
            throw new Error(`${reference.filename} has different distractors than ${references[0].filename}.`);
        }

        data.referenceSequences.forEach((variant, index) => {
            const variantItems = getStringSet(
                SequencerCore.stripFixedElements(variant.sequence, data.startingElements, data.endingElements)
            );

            if (!setsEqual(variantItems, expectedItems)) {
                const label = data.referenceSequences.length === 1 ? reference.filename : `${reference.filename} reference ${index + 1}`;
                throw new Error(`${label} must contain the same scored sequence items as ${references[0].filename}.`);
            }
        });
    });
}

function getReferenceItemSet(referenceData) {
    return getStringSet(
        SequencerCore.stripFixedElements(referenceData.sequence, referenceData.startingElements, referenceData.endingElements)
    );
}

function getStringSet(values) {
    return new Set(values);
}

function arraysEqual(first, second) {
    return first.length === second.length && first.every((value, index) => value === second[index]);
}

function setsEqual(first, second) {
    if (first.size !== second.size) {
        return false;
    }

    return [...first].every(value => second.has(value));
}

function setProcessingState(processing) {
    isProcessing = processing;

    const processButton = document.getElementById("process-button");
    const exportButton = document.getElementById("export-report-button");
    const printButton = document.getElementById("print-report-button");
    const clearStudentFilesButton = document.getElementById("clear-student-files-button");
    const clearAllButton = document.getElementById("clear-all-button");

    processButton.disabled = processing;
    processButton.textContent = processing ? "Generating Report..." : "Generate Class Report";
    exportButton.disabled = processing || !classReport;
    printButton.disabled = processing || !classReport;
    clearStudentFilesButton.disabled = processing;
    clearAllButton.disabled = processing;
}

function updateAnalyzeButtons() {
    setProcessingState(isProcessing);
}

function resetReportData() {
    allResults = [];
    processedFileResults = [];
    classReport = null;
    renderedReportPanels = new Set();
    Object.keys(reportPageState).forEach(view => {
        reportPageState[view] = 1;
    });

    const report = document.getElementById("class-report");
    report.hidden = true;
    report.classList.remove("show-full-text");
    document.getElementById("show-full-text").checked = false;
    document.getElementById("overview-panel").replaceChildren();
    document.getElementById("elements-panel").replaceChildren();
    document.getElementById("relationships-table-container").replaceChildren();
    document.getElementById("visual-patterns-panel").replaceChildren();
    document.getElementById("exclusions-panel").replaceChildren();
    document.getElementById("student-results-panel").replaceChildren();
    updateAnalyzeButtons();
}

function clearAnalysisResults(message) {
    resetReportData();

    if (message) {
        announceAnalysisStatus(message);
    }
}

function clearStudentFiles() {
    if (isProcessing) {
        return;
    }

    SequencerUI.clearFileSelection("sequence-files", "studentFilesDropZone", "No files selected");
    clearAnalysisResults("Student files and report cleared. Reference file retained.");
}

function clearAllAnalysis() {
    if (isProcessing) {
        return;
    }

    SequencerUI.clearFileSelection("reference-file", "referenceFileDropZone", "No files selected");
    SequencerUI.clearFileSelection("sequence-files", "studentFilesDropZone", "No files selected");
    referenceFileNameRoot = "";
    clearAnalysisResults("Reference file, student files, and report cleared.");
}

function announceAnalysisStatus(message) {
    const status = document.getElementById("analysisStatus");

    if (!status) {
        return;
    }

    status.textContent = "";
    window.setTimeout(() => {
        status.textContent = message;
    }, 10);
}

function getReferenceFileNameRoot(filename) {
    return filename
        .replace(/_reference\.seq$/i, "")
        .replace(/\.seq$/i, "") || "sequencer";
}

function parseStudentFilename(filename) {
    const baseName = String(filename || "").replace(/\.[^.]*$/, "");
    const match = baseName.match(/^(.+?)[\s_-]*(\d{7})(?=$|[\s_.-])/);

    if (!match) {
        return {
            studentName: "",
            canvasId: ""
        };
    }

    return {
        studentName: match[1]
            .replace(/[_]+/g, " ")
            .replace(/\s+/g, " ")
            .replace(/[\s_-]+$/g, "")
            .trim(),
        canvasId: match[2]
    };
}

function renderClassReport() {
    if (!classReport) {
        return;
    }

    const invalidCount = processedFileResults.filter(fileResult => fileResult.error).length;
    const scoringReferenceCount = classReport.scoringReferenceCount || 1;
    const diagnosticReference = classReport.diagnosticReferenceFileName || referenceFileNameRoot;
    const summary = document.getElementById("class-report-summary");
    summary.textContent = `${referenceFileNameRoot}: ${classReport.submissionCount} valid ${classReport.submissionCount === 1 ? "submission" : "submissions"}, `
        + `${invalidCount} invalid ${invalidCount === 1 ? "file" : "files"}, `
        + `${scoringReferenceCount} scoring ${scoringReferenceCount === 1 ? "reference" : "references"}, `
        + `class diagnostics use ${diagnosticReference}, `
        + `${classReport.elementCount} sequence ${classReport.elementCount === 1 ? "element" : "elements"}, `
        + `${classReport.distractorCount} ${classReport.distractorCount === 1 ? "distractor" : "distractors"}, `
        + `${classReport.confusionHotspots.length} key confusion ${classReport.confusionHotspots.length === 1 ? "hotspot" : "hotspots"} identified.`;

    populateRelationshipElementFilter();
    renderOverview();
    renderedReportPanels.add("overview-panel");
    activateReportTab("overview-panel");
    document.getElementById("class-report").hidden = false;
    document.getElementById("class-report-heading").focus();
    updateAnalyzeButtons();
}

function populateRelationshipElementFilter() {
    const select = document.getElementById("relationship-element-filter");
    select.replaceChildren();
    select.appendChild(createOption("", "All elements"));

    classReport.elements.forEach(element => {
        select.appendChild(createOption(element.label, `${element.label}: ${element.text}`));
    });
}

function createOption(value, text) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    return option;
}

function activateReportTab(panelId) {
    ensureReportPanelRendered(panelId);

    document.querySelectorAll("[data-report-tab]").forEach(tab => {
        const selected = tab.dataset.reportTab === panelId;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    });

    document.querySelectorAll(".report-panel").forEach(panel => {
        panel.hidden = panel.id !== panelId;
    });
}

function ensureReportPanelRendered(panelId) {
    if (!classReport || renderedReportPanels.has(panelId)) {
        return;
    }

    if (panelId === "elements-panel") {
        renderElements();
    } else if (panelId === "relationships-panel") {
        renderRelationships();
    } else if (panelId === "visual-patterns-panel") {
        renderVisualPatterns();
    } else if (panelId === "exclusions-panel") {
        renderExclusions();
    } else if (panelId === "student-results-panel") {
        renderStudentResults();
    }

    renderedReportPanels.add(panelId);
}

function renderOverview() {
    const panel = document.getElementById("overview-panel");
    panel.replaceChildren();
    panel.appendChild(makeElement("h3", "", "Sequence Ordering Overview"));
    panel.appendChild(createConfusionHotspotFindings());
    panel.appendChild(createSequenceOverview());
    panel.appendChild(createSequenceSegmentFindings());
    panel.appendChild(createBroadSequenceFindings());
    panel.appendChild(createIsolatedRelationshipFindings());

    panel.appendChild(makeElement("h3", "supporting-summary-heading", "Supporting Class Summary"));

    const invalidCount = processedFileResults.filter(fileResult => fileResult.error).length;
    const metrics = makeElement("div", "metric-grid");
    metrics.appendChild(createMetricCard("Valid submissions", classReport.submissionCount));
    metrics.appendChild(createMetricCard("Invalid files", invalidCount));
    metrics.appendChild(createMetricCard("Mean pairwise relative-order score", formatPercent(classReport.scoreSummary.pairwiseMean)));
    metrics.appendChild(createMetricCard("Median pairwise relative-order score", formatPercent(classReport.scoreSummary.pairwiseMedian)));
    metrics.appendChild(createMetricCard("Mean adjacent-pair score", formatPercent(classReport.scoreSummary.adjacentMean)));
    metrics.appendChild(createMetricCard("Median adjacent-pair score", formatPercent(classReport.scoreSummary.adjacentMedian)));
    metrics.appendChild(createMetricCard("Mean hybrid local-global score", formatPercent(classReport.scoreSummary.hybridMean)));
    metrics.appendChild(createMetricCard("Median hybrid local-global score", formatPercent(classReport.scoreSummary.hybridMedian)));
    metrics.appendChild(createMetricCard("Pairwise reversal baseline", formatPercent(classReport.overallRelationshipErrorRate)));
    panel.appendChild(metrics);

    const findings = makeElement("div", "overview-findings");
    findings.appendChild(createTopDistractorsFinding());
    findings.appendChild(createItemIssuesFinding());
    panel.appendChild(findings);
}

function createConfusionHotspotFindings() {
    const section = makeElement("section", "sequence-findings-section key-hotspots-section");
    section.appendChild(makeElement("h4", "", "Key Confusion Hotspots"));

    if (classReport.confusionHotspots.length === 0) {
        section.appendChild(makeElement(
            "p",
            "empty-message",
            "No small event range stood out above the classwide pairwise error baseline."
        ));
        return section;
    }

    classReport.confusionHotspots.forEach(hotspot => {
        section.appendChild(createHotspotFindingCard(hotspot));
    });
    return section;
}

function createHotspotFindingCard(hotspot) {
    const card = makeElement("article", "segment-finding-card hotspot-finding-card");
    card.appendChild(makeElement("h5", "", `Hotspot ${hotspot.hotspotRank}: ${hotspot.startLabel}-${hotspot.endLabel}`));
    card.appendChild(makeElement(
        "p",
        "segment-finding-summary",
        `${formatPercent(hotspot.pairwiseErrorRate)} of eligible pairwise comparisons inside this range were reversed `
        + `(${hotspot.reversedComparisons}/${hotspot.eligibleComparisons}), compared with `
        + `${formatPercent(hotspot.baselineErrorRate)} classwide. This hotspot accounts for `
        + `${formatPercent(hotspot.impactRate)} of all pairwise ordering errors.`
    ));
    card.appendChild(makeElement("h6", "", "Expected order"));
    card.appendChild(makeElement("p", "order-pattern expected-order-pattern", hotspot.expectedLabels.join(" -> ")));

    const relationshipRows = hotspot.topRelationships.slice(0, 5);
    card.appendChild(makeElement("h6", "", "Most reversed relationships"));
    card.appendChild(createReportTable({
        rows: relationshipRows,
        columns: [
            {
                label: "Expected Relationship",
                render: relationship => createRelationshipCell(relationship)
            },
            {
                label: "Students Reversing It",
                render: relationship => formatCountRate(
                    relationship.reversedStudents,
                    relationship.eligibleStudents,
                    relationship.reversalRate
                )
            }
        ],
        emptyMessage: "No reversed relationships were recorded inside this hotspot."
    }));

    card.appendChild(makeElement("h6", "", "Placement direction"));
    card.appendChild(createReportTable({
        rows: [...hotspot.elementDirections].sort((first, second) => (
            Math.max(second.tooEarlyRate || 0, second.tooLateRate || 0)
            - Math.max(first.tooEarlyRate || 0, first.tooLateRate || 0)
        )),
        columns: [
            {
                label: "Element",
                render: element => createElementReference(element.label, element.text)
            },
            {
                label: "Too Early",
                render: element => formatCountRate(
                    element.tooEarlyStudents,
                    element.tooEarlyEligibleStudents,
                    element.tooEarlyRate
                )
            },
            {
                label: "Too Late",
                render: element => formatCountRate(
                    element.tooLateStudents,
                    element.tooLateEligibleStudents,
                    element.tooLateRate
                )
            }
        ]
    }));

    const commonOrders = hotspot.commonIncorrectOrders.slice(0, 3);
    if (commonOrders.length > 0) {
        const details = createLazyDetails("View common relative orders in this hotspot", detailsElement => {
            detailsElement.appendChild(createReportTable({
                rows: commonOrders,
                columns: [
                    {
                        label: "Observed Relative Order",
                        render: pattern => makeElement("span", "order-pattern", pattern.labels.join(" -> "))
                    },
                    {
                        label: "Pattern",
                        render: pattern => pattern.description
                    },
                    {
                        label: "Students",
                        render: pattern => formatCountRate(pattern.count, hotspot.eligibleStudents, pattern.rate)
                    }
                ]
            }));
        });
        card.appendChild(details);
    }

    return card;
}

function createSequenceOverview() {
    const section = makeElement("section", "sequence-overview");
    section.appendChild(makeElement("h4", "", "Expected Sequence"));
    const list = makeElement("div", "sequence-overview-list");
    const rangeFindings = (classReport.confusionHotspots.length > 0
        ? [...classReport.confusionHotspots]
        : [...classReport.sequenceSegments, ...classReport.broadSequenceConfusion])
        .sort((first, second) => first.startIndex - second.startIndex);
    const findingByStartIndex = new Map(rangeFindings.map(finding => [finding.startIndex, finding]));
    const segmentNumberByStartIndex = getSequenceSegmentNumberByStartIndex();
    const isolatedByElementIndex = new Map();

    classReport.isolatedRelationshipErrors.forEach(relationship => {
        [relationship.firstIndex, relationship.secondIndex].forEach(index => {
            if (!isolatedByElementIndex.has(index)) {
                isolatedByElementIndex.set(index, []);
            }
            isolatedByElementIndex.get(index).push(relationship);
        });
    });

    classReport.startingElements.forEach((text, index) => {
        list.appendChild(createFixedSequenceRow(`Fixed start${classReport.startingElements.length > 1 ? ` ${index + 1}` : ""}`, text));
    });

    let index = 0;
    while (index < classReport.elements.length) {
        const finding = findingByStartIndex.get(index);

        if (finding) {
            const isHotspot = Number.isInteger(finding.hotspotRank);
            const isBroad = finding.endIndex - finding.startIndex + 1 > classReport.maxSegmentElements;
            const block = makeElement(
                "section",
                isHotspot
                    ? "sequence-range-block hotspot-range-block"
                    : isBroad ? "sequence-range-block broad-range-block" : "sequence-range-block"
            );
            block.appendChild(makeElement(
                "h5",
                "sequence-range-heading",
                isHotspot
                    ? `Key confusion hotspot ${finding.hotspotRank}: ${finding.startLabel}-${finding.endLabel}`
                    : isBroad
                    ? `Broad ordering confusion: ${finding.startLabel}-${finding.endLabel}`
                    : `Ordering confusion segment ${segmentNumberByStartIndex.get(finding.startIndex)}: ${finding.startLabel}-${finding.endLabel}`
            ));
            block.appendChild(makeElement(
                "p",
                "sequence-range-rate",
                isHotspot
                    ? `${formatPercent(finding.pairwiseErrorRate)} pairwise reversal rate; ${formatPercent(finding.impactRate)} of all pairwise errors.`
                    : `${formatCountRate(finding.affectedStudents, finding.eligibleStudents, finding.affectedRate)} of eligible submissions used a different internal order.`
            ));

            finding.elements.forEach(element => {
                block.appendChild(createSequenceElementRow(element));
            });
            list.appendChild(block);
            index = finding.endIndex + 1;
            continue;
        }

        list.appendChild(createSequenceElementRow(
            classReport.elements[index],
            isolatedByElementIndex.get(index)?.length
                ? `${isolatedByElementIndex.get(index).length} frequent isolated relationship ${isolatedByElementIndex.get(index).length === 1 ? "error" : "errors"}`
                : ""
        ));
        index++;
    }

    classReport.endingElements.forEach((text, endIndex) => {
        list.appendChild(createFixedSequenceRow(`Fixed end${classReport.endingElements.length > 1 ? ` ${endIndex + 1}` : ""}`, text));
    });

    section.appendChild(list);
    return section;
}

function createSequenceElementRow(element, annotation = "") {
    const row = makeElement("div", "sequence-overview-row");
    row.appendChild(createElementReference(element.label, element.text));

    if (annotation) {
        row.appendChild(makeElement("span", "sequence-row-annotation", annotation));
    }

    return row;
}

function createFixedSequenceRow(label, text) {
    const row = makeElement("div", "sequence-overview-row fixed-sequence-row");
    row.appendChild(createElementReference(label, text));
    return row;
}

function createSequenceSegmentFindings() {
    const section = makeElement("section", "sequence-findings-section");
    section.appendChild(makeElement("h4", "", "Ordering Confusion Segments"));

    if (classReport.sequenceSegments.length === 0) {
        section.appendChild(makeElement(
            "p",
            "empty-message",
            `No contiguous 3-${classReport.maxSegmentElements} element range contained at least two relationships meeting the reporting threshold.`
        ));
        return section;
    }

    const segmentNumberByStartIndex = getSequenceSegmentNumberByStartIndex();
    classReport.sequenceSegments.forEach(segment => {
        section.appendChild(createSegmentFindingCard(segment, segmentNumberByStartIndex.get(segment.startIndex)));
    });
    return section;
}

function getSequenceSegmentNumberByStartIndex() {
    return new Map(
        [...classReport.sequenceSegments]
            .sort((first, second) => first.startIndex - second.startIndex)
            .map((segment, index) => [segment.startIndex, index + 1])
    );
}

function createSegmentFindingCard(segment, index) {
    const card = makeElement("article", "segment-finding-card");
    card.appendChild(makeElement("h5", "", `Ordering Confusion Segment ${index}: ${segment.startLabel}-${segment.endLabel}`));
    card.appendChild(makeElement(
        "p",
        "segment-finding-summary",
        `${formatCountRate(segment.affectedStudents, segment.eligibleStudents, segment.affectedRate)} of eligible submissions used a different order within this segment.`
    ));
    card.appendChild(makeElement("h6", "", "Expected order"));
    card.appendChild(makeElement("p", "order-pattern expected-order-pattern", segment.expectedLabels.join(" -> ")));

    const expectedList = makeElement("ol", "segment-element-list");
    segment.elements.forEach(element => {
        const item = document.createElement("li");
        item.appendChild(createElementReference(element.label, element.text));
        expectedList.appendChild(item);
    });
    card.appendChild(expectedList);
    card.appendChild(makeElement("h6", "", "Most common incorrect relative orders"));

    const commonOrders = segment.commonIncorrectOrders.slice(0, 5);
    if (commonOrders.length === 0) {
        card.appendChild(makeElement("p", "empty-message", "No incorrect relative orders were recorded among eligible submissions."));
    } else {
        card.appendChild(createReportTable({
            rows: commonOrders,
            columns: [
                {
                    label: "Observed Relative Order",
                    render: pattern => makeElement("span", "order-pattern", pattern.labels.join(" -> "))
                },
                {
                    label: "Pattern",
                    render: pattern => pattern.description
                },
                {
                    label: "Students",
                    render: pattern => formatCountRate(pattern.count, segment.eligibleStudents, pattern.rate)
                }
            ]
        }));
    }

    const relationshipDetails = createLazyDetails("View relationships explaining this segment", details => {
        details.appendChild(createReportTable({
            rows: segment.frequentRelationships,
            columns: [
                {
                    label: "Expected Relationship",
                    render: relationship => createRelationshipCell(relationship)
                },
                {
                    label: "Students Reversing It",
                    render: relationship => formatCountRate(
                        relationship.reversedStudents,
                        relationship.eligibleStudents,
                        relationship.reversalRate
                    )
                }
            ]
        }));
    });
    card.appendChild(relationshipDetails);
    return card;
}

function createBroadSequenceFindings() {
    const section = makeElement("section", "sequence-findings-section");
    section.appendChild(makeElement("h4", "", "Broad Sequence Confusion"));

    if (classReport.broadSequenceConfusion.length === 0) {
        section.appendChild(makeElement("p", "empty-message", "No connected ordering-error pattern extended beyond the segment reporting limit."));
        return section;
    }

    classReport.broadSequenceConfusion.forEach(finding => {
        const card = makeElement("article", "segment-finding-card broad-finding-card");
        card.appendChild(makeElement("h5", "", `${finding.startLabel}-${finding.endLabel}`));
        card.appendChild(makeElement(
            "p",
            "segment-finding-summary",
            `${formatCountRate(finding.affectedStudents, finding.eligibleStudents, finding.affectedRate)} of eligible submissions used a different internal order across this range.`
        ));
        card.appendChild(makeElement("p", "order-pattern expected-order-pattern", finding.expectedLabels.join(" -> ")));

        const details = createLazyDetails("View frequent relationships in this range", detailsElement => {
            const list = document.createElement("ul");
            finding.frequentRelationships.forEach(relationship => {
                const item = document.createElement("li");
                item.textContent = `${relationship.secondLabel} placed before ${relationship.firstLabel}; expected `
                    + `${relationship.firstLabel} before ${relationship.secondLabel}: `
                    + formatCountRate(relationship.reversedStudents, relationship.eligibleStudents, relationship.reversalRate);
                list.appendChild(item);
            });
            detailsElement.appendChild(list);
        });
        card.appendChild(details);
        section.appendChild(card);
    });
    return section;
}

function createIsolatedRelationshipFindings() {
    const section = makeElement("section", "sequence-findings-section");
    section.appendChild(makeElement("h4", "", "Isolated Relationship Errors"));

    if (classReport.isolatedRelationshipErrors.length === 0) {
        section.appendChild(makeElement("p", "empty-message", "No frequent two-element ordering errors occurred outside the identified ranges."));
        return section;
    }

    section.appendChild(createReportTable({
        rows: classReport.isolatedRelationshipErrors,
        columns: [
            {
                label: "Expected Relationship",
                render: relationship => createRelationshipCell(relationship)
            },
            {
                label: "Students Reversing It",
                render: relationship => formatCountRate(
                    relationship.reversedStudents,
                    relationship.eligibleStudents,
                    relationship.reversalRate
                )
            }
        ]
    }));
    return section;
}

function createMetricCard(label, value) {
    const card = makeElement("div", "metric-card");
    card.appendChild(makeElement("span", "metric-label", label));
    card.appendChild(makeElement("strong", "metric-value", String(value)));
    return card;
}

function createFindingSection(title) {
    const section = makeElement("section", "finding-section");
    section.appendChild(makeElement("h4", "", title));
    return section;
}

function createTopDistractorsFinding() {
    const section = createFindingSection("Most Frequently Retained Distractors");
    const distractors = [...classReport.distractors]
        .filter(distractor => distractor.retainedStudents > 0)
        .sort((first, second) => second.retentionRate - first.retentionRate)
        .slice(0, 3);

    if (classReport.distractors.length === 0) {
        section.appendChild(makeElement("p", "empty-message", "The reference file does not define distractors."));
        return section;
    }

    if (distractors.length === 0) {
        section.appendChild(makeElement("p", "empty-message", "No distractors were retained."));
        return section;
    }

    const list = makeElement("ol", "finding-list");
    distractors.forEach(distractor => {
        const item = document.createElement("li");
        item.appendChild(createElementReference(distractor.label, distractor.text));
        item.appendChild(makeElement(
            "span",
            "finding-metric",
            `${formatCountRate(distractor.retainedStudents, classReport.submissionCount, distractor.retentionRate)} retained`
            + `${distractor.commonPlacement ? `; most commonly ${distractor.commonPlacement.toLowerCase()}` : ""}`
        ));
        list.appendChild(item);
    });
    section.appendChild(list);
    return section;
}

function createItemIssuesFinding() {
    const section = createFindingSection("Submission Item Flags");
    const list = makeElement("ul", "finding-list");
    const summary = classReport.scoreSummary;

    [
        ["Submissions with missing elements", summary.submissionsWithMissingItems],
        ["Submissions with extra elements", summary.submissionsWithExtraItems],
        ["Submissions with duplicate elements", summary.submissionsWithDuplicateItems]
    ].forEach(([label, count]) => {
        const item = document.createElement("li");
        item.appendChild(makeElement("strong", "", label));
        item.appendChild(makeElement("span", "finding-metric", formatCountRate(count, classReport.submissionCount)));
        list.appendChild(item);
    });

    section.appendChild(list);
    return section;
}

function renderElements() {
    if (!classReport) {
        return;
    }

    const panel = document.getElementById("elements-panel");
    panel.replaceChildren();
    panel.appendChild(makeElement("h3", "", "Element Confusion Summary"));
    panel.appendChild(makeElement(
        "p",
        "report-description",
        "Students Affected counts submissions with at least one reversed relationship involving the element. Relationship Error Rate counts all reversed eligible relationships involving the element."
    ));

    const rows = paginateRows(sortRows(classReport.elements, "elements"), "elements");
    panel.appendChild(createReportTable({
        view: "elements",
        caption: "Element-level ordering confusion. Eligible denominators exclude submissions where the required element is missing or duplicated.",
        rows: rows.items,
        pagination: rows,
        columns: [
            {
                label: "Element",
                sortKey: "index",
                render: element => createElementSummaryCell(element)
            },
            {
                label: "Students Affected",
                sortKey: "affectedRate",
                render: element => formatCountRate(element.affectedStudents, element.eligibleStudents, element.affectedRate)
            },
            {
                label: "Relationship Error Rate",
                sortKey: "relationshipErrorRate",
                render: element => formatCountRate(element.relationshipErrors, element.eligibleRelationships, element.relationshipErrorRate)
            },
            {
                label: "Too Early",
                sortKey: "tooEarlyRate",
                render: element => formatCountRate(element.tooEarlyStudents, element.tooEarlyEligibleStudents, element.tooEarlyRate)
            },
            {
                label: "Too Late",
                sortKey: "tooLateRate",
                render: element => formatCountRate(element.tooLateStudents, element.tooLateEligibleStudents, element.tooLateRate)
            },
            {
                label: "Missing",
                sortKey: "missingRate",
                render: element => formatCountRate(element.missingStudents, classReport.submissionCount, element.missingRate)
            }
        ]
    }));
}

function createElementSummaryCell(element) {
    const container = makeElement("div", "element-summary-cell");
    container.appendChild(createElementReference(element.label, element.text));

    const details = createLazyDetails("View element evidence", detailsElement => {
        detailsElement.appendChild(makeElement("p", "full-element-text", element.text));
        detailsElement.appendChild(makeElement("h5", "", "Most frequent relationship errors"));

        if (element.relationshipErrorsDetail.length === 0) {
            detailsElement.appendChild(makeElement("p", "empty-message", "No reversed relationships involving this element."));
        } else {
            const list = document.createElement("ul");
            element.relationshipErrorsDetail.forEach(relationship => {
                const item = document.createElement("li");
                item.textContent = `${relationship.secondLabel} placed before ${relationship.firstLabel}; expected `
                    + `${relationship.firstLabel} before ${relationship.secondLabel}: `
                    + formatCountRate(relationship.reversedStudents, relationship.eligibleStudents, relationship.reversalRate);
                list.appendChild(item);
            });
            detailsElement.appendChild(list);
        }

        detailsElement.appendChild(makeElement("h5", "", "Immediate relationships"));
        if (element.immediateRelationships.length === 0) {
            detailsElement.appendChild(makeElement("p", "empty-message", "This element has no immediate neighbor relationships."));
        } else {
            const list = document.createElement("ul");
            element.immediateRelationships.forEach(relationship => {
                const item = document.createElement("li");
                item.textContent = `${relationship.firstLabel} immediately before ${relationship.secondLabel}: `
                    + `${formatCountRate(relationship.correctStudents, relationship.eligibleStudents, relationship.correctRate)} correct`;
                list.appendChild(item);
            });
            detailsElement.appendChild(list);
        }
    });

    container.appendChild(details);
    return container;
}

function renderRelationships() {
    if (!classReport) {
        return;
    }

    const container = document.getElementById("relationships-table-container");
    const elementFilter = document.getElementById("relationship-element-filter").value;
    const relationshipType = document.getElementById("relationship-type-filter").value;
    const errorsOnly = document.getElementById("relationship-errors-only").checked;
    let rows = classReport.relationships.filter(relationship => {
        if (elementFilter && relationship.firstLabel !== elementFilter && relationship.secondLabel !== elementFilter) {
            return false;
        }

        if (relationshipType === "immediate" && !relationship.isImmediate) {
            return false;
        }

        if (!errorsOnly) {
            return true;
        }

        if (relationshipType === "immediate") {
            return relationship.reversedStudents > 0
                || relationship.immediateCorrectStudents < relationship.eligibleStudents;
        }

        return relationship.reversedStudents > 0;
    });
    rows = paginateRows(sortRows(rows, "relationships"), "relationships");

    const columns = [
        {
            label: "Expected Relationship",
            sortKey: "firstIndex",
            render: relationship => createRelationshipCell(relationship)
        },
        {
            label: "Students Reversing It",
            sortKey: "reversedStudents",
            render: relationship => `${relationship.reversedStudents} / ${relationship.eligibleStudents} eligible`
        },
        {
            label: "Reversal Frequency",
            sortKey: "reversalRate",
            render: relationship => formatPercent(relationship.reversalRate)
        }
    ];

    if (relationshipType === "immediate") {
        columns.push(
            {
                label: "Immediate Placement Correct",
                sortKey: "immediateCorrectStudents",
                render: relationship => `${relationship.immediateCorrectStudents} / ${relationship.eligibleStudents} eligible`
            },
            {
                label: "Immediate Correctness",
                sortKey: "immediateCorrectRate",
                render: relationship => formatPercent(relationship.immediateCorrectRate)
            }
        );
    }

    container.replaceChildren(createReportTable({
        view: "relationships",
        caption: relationshipType === "immediate"
            ? "Immediate-neighbor evidence. Correctness requires the first element to appear directly before the second."
            : "Pairwise precedence evidence. Eligible denominators include submissions containing both elements exactly once.",
        rows: rows.items,
        pagination: rows,
        columns,
        emptyMessage: errorsOnly ? "No relationship errors match the selected filters." : "No relationships match the selected filters."
    }));
}

function createRelationshipCell(relationship) {
    const container = makeElement("div", "relationship-cell");
    const label = makeElement("strong", "relationship-label");
    label.appendChild(document.createTextNode(relationship.firstLabel));
    label.appendChild(makeElement("span", "relationship-operator", "before"));
    label.appendChild(document.createTextNode(relationship.secondLabel));
    container.appendChild(label);

    const inlineText = makeElement("span", "relationship-full-text full-text-only");
    inlineText.appendChild(makeElement("span", "relationship-text-part", relationship.firstText));
    inlineText.appendChild(makeElement("span", "relationship-operator", "before"));
    inlineText.appendChild(makeElement("span", "relationship-text-part", relationship.secondText));
    container.appendChild(inlineText);
    return container;
}

function renderVisualPatterns() {
    if (!classReport) {
        return;
    }

    const panel = document.getElementById("visual-patterns-panel");
    panel.replaceChildren();
    panel.appendChild(makeElement("h3", "", "Visual Patterns"));
    panel.appendChild(createAdjacencyHeatMap());
    panel.appendChild(createPrecedenceHeatMap());
    panel.appendChild(createDominantPatternSection());
}

function createAdjacencyHeatMap() {
    const transitions = classReport.adjacencyTransitions || [];
    const transitionByIndexes = new Map(transitions.map(transition => [
        heatMapPairKey(transition.firstIndex, transition.secondIndex),
        transition
    ]));

    return createHeatMapSection({
        title: "Immediate Next Event",
        description: "Cell values show how often the column event immediately followed the row event.",
        elements: classReport.elements,
        className: "adjacency-heat-map",
        emptyMessage: "At least two sequence elements are needed for an adjacency map.",
        getCell: (first, second) => {
            if (first.index === second.index) {
                return null;
            }

            const transition = transitionByIndexes.get(heatMapPairKey(first.index, second.index));

            if (!transition) {
                return null;
            }

            return {
                rate: transition.adjacencyRate,
                count: transition.adjacentStudents,
                total: transition.eligibleStudents,
                emphasized: transition.isReferenceNext,
                label: `${first.label} immediately before ${second.label}`
            };
        }
    });
}

function createPrecedenceHeatMap() {
    const relationshipByIndexes = new Map(classReport.relationships.map(relationship => [
        heatMapPairKey(relationship.firstIndex, relationship.secondIndex),
        relationship
    ]));

    return createHeatMapSection({
        title: "Correct Before/After Relationships",
        description: "Cell values show how often students preserved the expected before/after relationship.",
        elements: classReport.elements,
        className: "precedence-heat-map",
        emptyMessage: "At least two sequence elements are needed for a precedence map.",
        getCell: (first, second) => {
            if (first.index >= second.index) {
                return null;
            }

            const relationship = relationshipByIndexes.get(heatMapPairKey(first.index, second.index));

            if (!relationship) {
                return null;
            }

            const correctStudents = relationship.eligibleStudents - relationship.reversedStudents;
            const correctRate = relationship.eligibleStudents > 0
                ? correctStudents / relationship.eligibleStudents * 100
                : NaN;

            return {
                rate: correctRate,
                count: correctStudents,
                total: relationship.eligibleStudents,
                emphasized: false,
                label: `${first.label} before ${second.label}`
            };
        }
    });
}

function createHeatMapSection(options) {
    const section = makeElement("section", `visual-pattern-section ${options.className || ""}`.trim());
    section.appendChild(makeElement("h4", "", options.title));
    section.appendChild(makeElement("p", "report-description", options.description));

    if (options.elements.length < 2) {
        section.appendChild(makeElement("p", "empty-message", options.emptyMessage));
        return section;
    }

    section.appendChild(createHeatMapLegend());

    const scroll = makeElement("div", "heat-map-scroll");
    const table = makeElement("table", `heat-map-table${options.elements.length > 24 ? " dense-heat-map" : ""}`);
    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    headingRow.appendChild(makeElement("th", "heat-map-corner", ""));
    options.elements.forEach(element => {
        const heading = makeElement("th", "heat-map-axis-label", element.label);
        heading.scope = "col";
        heading.title = element.text;
        headingRow.appendChild(heading);
    });
    head.appendChild(headingRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    options.elements.forEach(first => {
        const row = document.createElement("tr");
        const rowHeading = makeElement("th", "heat-map-axis-label", first.label);
        rowHeading.scope = "row";
        rowHeading.title = first.text;
        row.appendChild(rowHeading);

        options.elements.forEach(second => {
            const cellData = options.getCell(first, second);
            const cell = makeElement("td", "heat-map-cell");

            if (!cellData) {
                cell.classList.add("heat-map-empty-cell");
                cell.setAttribute("aria-label", `${first.label} to ${second.label} not shown`);
                row.appendChild(cell);
                return;
            }

            const rate = Number.isFinite(cellData.rate) ? cellData.rate : NaN;
            cell.style.backgroundColor = getHeatMapColor(rate);
            cell.style.color = getHeatMapTextColor(rate);
            cell.dataset.rate = Number.isFinite(rate) ? SequencerCore.formatNumber(rate, 2) : "";
            cell.textContent = formatHeatMapValue(rate);
            cell.title = `${cellData.label}: ${formatCountRate(cellData.count, cellData.total, rate)}`;
            cell.setAttribute("aria-label", cell.title);

            if (cellData.emphasized) {
                cell.classList.add("expected-transition-cell");
            }

            row.appendChild(cell);
        });

        body.appendChild(row);
    });
    table.appendChild(body);
    scroll.appendChild(table);
    section.appendChild(scroll);
    return section;
}

function heatMapPairKey(firstIndex, secondIndex) {
    return `${firstIndex}:${secondIndex}`;
}

function createHeatMapLegend() {
    const legend = makeElement("div", "heat-map-legend");
    legend.appendChild(makeElement("span", "", "0%"));
    legend.appendChild(makeElement("span", "heat-map-gradient"));
    legend.appendChild(makeElement("span", "", "100%"));
    return legend;
}

function getHeatMapColor(rate) {
    if (!Number.isFinite(rate)) {
        return "#eef1f4";
    }

    const t = Math.max(0, Math.min(1, rate / 100));
    return interpolateRgb([239, 246, 252], [7, 81, 132], t);
}

function getHeatMapTextColor(rate) {
    return Number.isFinite(rate) && rate >= 62 ? "#ffffff" : "#1f2933";
}

function interpolateRgb(start, end, t) {
    const values = start.map((value, index) => Math.round(value + (end[index] - value) * t));
    return `rgb(${values.join(", ")})`;
}

function formatHeatMapValue(rate) {
    return Number.isFinite(rate) ? `${SequencerCore.formatNumber(rate, 0)}%` : "";
}

function createDominantPatternSection() {
    const section = makeElement("section", "visual-pattern-section dominant-pattern-section");
    section.appendChild(makeElement("h4", "", "Most Common Reordered Sequence"));

    const candidates = getDominantPatternCandidates();

    if (candidates.length === 0) {
        section.appendChild(makeElement(
            "p",
            "empty-message",
            "No hotspot or segment had one repeated reordered sequence that met the display threshold."
        ));
        return section;
    }

    const cards = makeElement("div", "dominant-pattern-grid");
    candidates.forEach(candidate => {
        cards.appendChild(createDominantPatternCard(candidate));
    });
    section.appendChild(cards);
    return section;
}

function getDominantPatternCandidates() {
    const candidates = [];
    const usedRangeKeys = new Set();
    const segmentNumberByStartIndex = getSequenceSegmentNumberByStartIndex();

    classReport.confusionHotspots.forEach(hotspot => {
        addDominantPatternCandidate(candidates, usedRangeKeys, {
            label: `Hotspot ${hotspot.hotspotRank}: ${hotspot.startLabel}-${hotspot.endLabel}`,
            finding: hotspot,
            priority: hotspot.priorityScore || 0
        });
    });

    classReport.sequenceSegments.forEach(segment => {
        addDominantPatternCandidate(candidates, usedRangeKeys, {
            label: `Segment ${segmentNumberByStartIndex.get(segment.startIndex)}: ${segment.startLabel}-${segment.endLabel}`,
            finding: segment,
            priority: segment.affectedRate || 0
        });
    });

    return candidates
        .sort((first, second) => second.coverageRate - first.coverageRate || second.priority - first.priority)
        .slice(0, 3);
}

function addDominantPatternCandidate(candidates, usedRangeKeys, candidate) {
    const finding = candidate.finding;
    const rangeKey = `${finding.startIndex}:${finding.endIndex}`;
    const topPattern = (finding.commonIncorrectOrders || [])
        .find(pattern => pattern.count >= DOMINANT_PATTERN_MIN_COUNT);
    const affectedStudents = finding.affectedStudents || 0;
    const patternRate = topPattern && affectedStudents > 0 ? topPattern.count / affectedStudents * 100 : NaN;

    if (
        usedRangeKeys.has(rangeKey)
        || !topPattern
        || !Number.isFinite(patternRate)
        || patternRate < DOMINANT_REORDER_MIN_RATE
    ) {
        return;
    }

    usedRangeKeys.add(rangeKey);
    candidates.push({
        ...candidate,
        pattern: topPattern,
        patterns: [topPattern],
        shownCount: topPattern.count,
        affectedStudents,
        coverageRate: patternRate,
        otherCount: Math.max(0, affectedStudents - topPattern.count)
    });
}

function createDominantPatternCard(candidate) {
    const card = makeElement("article", "dominant-pattern-card");
    card.appendChild(makeElement("h5", "", candidate.label));
    card.appendChild(makeElement(
        "p",
        "segment-finding-summary",
        `The most common reordered sequence was used by `
        + `${formatCountRate(candidate.pattern.count, candidate.affectedStudents, candidate.coverageRate)} of affected submissions.`
    ));
    card.appendChild(createReorderComparisonPlot(candidate));
    return card;
}

function createDominantPatternRows(candidate) {
    const rows = candidate.patterns.map(pattern => ({
        order: pattern.labels.join(" -> "),
        description: pattern.description,
        count: pattern.count,
        rate: candidate.affectedStudents > 0 ? pattern.count / candidate.affectedStudents * 100 : NaN
    }));

    if (candidate.otherCount > 0) {
        rows.push({
            order: "Other",
            description: "Other lower-frequency orders",
            count: candidate.otherCount,
            rate: candidate.affectedStudents > 0 ? candidate.otherCount / candidate.affectedStudents * 100 : NaN
        });
    }

    return rows;
}

function createReorderComparisonPlot(candidate) {
    const namespace = "http://www.w3.org/2000/svg";
    const expectedLabels = candidate.finding.expectedLabels || [];
    const observedLabels = candidate.pattern.labels || [];
    const rowCount = Math.max(expectedLabels.length, observedLabels.length);
    const width = 680;
    const top = 62;
    const rowGap = 44;
    const bottom = 30;
    const height = top + Math.max(rowCount - 1, 0) * rowGap + bottom;
    const leftX = 130;
    const rightX = width - 130;
    const nodeWidth = 68;
    const nodeHeight = 28;
    const expectedPositionByLabel = new Map(expectedLabels.map((label, index) => [label, index]));
    const observedPositionByLabel = new Map(observedLabels.map((label, index) => [label, index]));
    const getY = index => top + index * rowGap;

    const svg = document.createElementNS(namespace, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${candidate.label} reference order compared with most common reordered sequence`);
    svg.classList.add("reorder-plot");

    const title = document.createElementNS(namespace, "title");
    title.textContent = `${candidate.label}: reference order compared with most common reordered sequence`;
    svg.appendChild(title);

    appendSvgText(svg, namespace, leftX, 24, "Reference order", "reorder-column-heading");
    appendSvgText(svg, namespace, rightX, 24, "Most common submitted order", "reorder-column-heading");

    expectedLabels.forEach(label => {
        if (!observedPositionByLabel.has(label)) {
            return;
        }

        const expectedIndex = expectedPositionByLabel.get(label);
        const observedIndex = observedPositionByLabel.get(label);
        const sourceY = getY(expectedIndex);
        const targetY = getY(observedIndex);
        const path = document.createElementNS(namespace, "path");
        const sourceX = leftX + nodeWidth / 2;
        const targetX = rightX - nodeWidth / 2;
        const curve = (targetX - sourceX) * 0.45;

        path.setAttribute(
            "d",
            `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`
        );
        path.setAttribute("class", expectedIndex === observedIndex ? "reorder-flow reorder-flow-stable" : "reorder-flow reorder-flow-moved");

        const pathTitle = document.createElementNS(namespace, "title");
        pathTitle.textContent = `${label}: reference position ${expectedIndex + 1}, submitted position ${observedIndex + 1}`;
        path.appendChild(pathTitle);
        svg.appendChild(path);
    });

    expectedLabels.forEach((label, index) => {
        appendReorderNode(svg, namespace, {
            label,
            x: leftX,
            y: getY(index),
            width: nodeWidth,
            height: nodeHeight,
            moved: observedPositionByLabel.get(label) !== index,
            title: `${label}: reference position ${index + 1}`
        });
    });

    observedLabels.forEach((label, index) => {
        appendReorderNode(svg, namespace, {
            label,
            x: rightX,
            y: getY(index),
            width: nodeWidth,
            height: nodeHeight,
            moved: expectedPositionByLabel.get(label) !== index,
            title: `${label}: submitted position ${index + 1}`
        });
    });

    const wrapper = makeElement("div", "reorder-plot-wrapper");
    wrapper.appendChild(svg);
    wrapper.appendChild(makeElement("p", "reorder-pattern-label", candidate.pattern.labels.join(" -> ")));
    return wrapper;
}

function appendReorderNode(svg, namespace, options) {
    const rect = document.createElementNS(namespace, "rect");
    rect.setAttribute("x", String(options.x - options.width / 2));
    rect.setAttribute("y", String(options.y - options.height / 2));
    rect.setAttribute("width", String(options.width));
    rect.setAttribute("height", String(options.height));
    rect.setAttribute("rx", "4");
    rect.setAttribute("class", options.moved ? "reorder-node reorder-node-moved" : "reorder-node");

    const title = document.createElementNS(namespace, "title");
    title.textContent = options.title;
    rect.appendChild(title);
    svg.appendChild(rect);

    appendSvgText(svg, namespace, options.x, options.y + 4, options.label, "reorder-node-label");
}

function appendSvgText(svg, namespace, x, y, textContent, className) {
    const text = document.createElementNS(namespace, "text");
    text.setAttribute("x", String(x));
    text.setAttribute("y", String(y));
    text.setAttribute("class", className);
    text.textContent = textContent;
    svg.appendChild(text);
}

function renderExclusions() {
    if (!classReport) {
        return;
    }

    const panel = document.getElementById("exclusions-panel");
    panel.replaceChildren();
    panel.appendChild(makeElement("h3", "", "Exclusion and Item Decisions"));
    panel.appendChild(makeElement(
        "p",
        "report-description",
        "Distractor retention and item-selection errors are reported separately from ordering confusion."
    ));

    panel.appendChild(makeElement("h4", "", "Distractors Retained"));
    if (classReport.distractors.length === 0) {
        panel.appendChild(makeElement("p", "empty-message", "The reference file does not define distractors."));
    } else {
        const paginatedDistractors = paginateRows(
            sortRows(classReport.distractors, "distractors"),
            "distractors"
        );
        panel.appendChild(createReportTable({
            view: "distractors",
            caption: "Distractor elements that students should have excluded.",
            rows: paginatedDistractors.items,
            pagination: paginatedDistractors,
            columns: [
                {
                    label: "Distractor",
                    sortKey: "index",
                    render: distractor => createDistractorCell(distractor)
                },
                {
                    label: "Retained",
                    sortKey: "retentionRate",
                    render: distractor => formatCountRate(distractor.retainedStudents, classReport.submissionCount, distractor.retentionRate)
                },
                {
                    label: "Most Common Placement",
                    sortKey: "commonPlacement",
                    render: distractor => distractor.commonPlacement || "Not retained"
                }
            ]
        }));
    }

    panel.appendChild(makeElement("h4", "", "Correct Elements Omitted"));
    panel.appendChild(createIssueTable(
        "omitted",
        classReport.omittedElements,
        "No correct elements were omitted.",
        "Omitted Element"
    ));

    panel.appendChild(makeElement("h4", "", "Unknown Extra Elements"));
    panel.appendChild(createIssueTable(
        "unknown",
        classReport.unknownExtras,
        "No unknown extra elements were submitted.",
        "Extra Element"
    ));

    panel.appendChild(makeElement("h4", "", "Duplicated Elements"));
    panel.appendChild(createIssueTable(
        "duplicates",
        classReport.duplicates,
        "No elements were duplicated.",
        "Duplicated Element",
        true
    ));
}

function createDistractorCell(distractor) {
    const container = makeElement("div", "element-summary-cell");
    container.appendChild(createElementReference(distractor.label, distractor.text));
    const details = createLazyDetails("View exclusion evidence", detailsElement => {
        detailsElement.appendChild(makeElement("p", "full-element-text", distractor.text));
        detailsElement.appendChild(makeElement("h5", "", "Placements when retained"));

        if (distractor.placements.length === 0) {
            detailsElement.appendChild(makeElement("p", "empty-message", "This distractor was not retained."));
        } else {
            const placementList = document.createElement("ul");
            distractor.placements.forEach(placement => {
                const item = document.createElement("li");
                item.textContent = `${placement.description}: ${formatCountRate(placement.count, distractor.retainedStudents, placement.rateAmongRetained)}`;
                placementList.appendChild(item);
            });
            detailsElement.appendChild(placementList);
        }

        detailsElement.appendChild(makeElement("h5", "", "Possible substitutions"));
        if (distractor.possibleSubstitutions.length === 0) {
            detailsElement.appendChild(makeElement("p", "empty-message", "No submission retained this distractor while omitting a correct element."));
        } else {
            const substitutionList = document.createElement("ul");
            distractor.possibleSubstitutions.forEach(substitution => {
                const item = document.createElement("li");
                item.textContent = `${distractor.label} retained while ${substitution.omittedElementLabel} was omitted: `
                    + formatCountRate(substitution.count, classReport.submissionCount, substitution.rate);
                substitutionList.appendChild(item);
            });
            detailsElement.appendChild(substitutionList);
        }
    });

    container.appendChild(details);
    return container;
}

function createIssueTable(view, rows, emptyMessage, itemHeading, showKind = false) {
    if (rows.length === 0) {
        return makeElement("p", "empty-message", emptyMessage);
    }

    const columns = [
        {
            label: itemHeading,
            sortKey: "label",
            render: item => item.label
                ? createElementReference(item.label, item.text)
                : makeElement("span", "full-element-text", item.text)
        }
    ];

    if (showKind) {
        columns.push({
            label: "Type",
            sortKey: "kind",
            render: item => item.kind
        });
    }

    columns.push({
        label: "Submissions",
        sortKey: "rate",
        render: item => formatCountRate(item.count, classReport.submissionCount, item.rate)
    });

    const paginatedRows = paginateRows(sortRows(rows, view), view);
    return createReportTable({
        view,
        rows: paginatedRows.items,
        pagination: paginatedRows,
        columns
    });
}

function renderStudentResults() {
    if (!classReport) {
        return;
    }

    const panel = document.getElementById("student-results-panel");
    panel.replaceChildren();
    panel.appendChild(makeElement("h3", "", "Student Results"));
    panel.appendChild(makeElement(
        "p",
        "report-description",
        "Individual scores are retained for grading and review. Invalid files are listed with their processing error."
    ));

    const rows = processedFileResults.map(fileResult => {
        const studentMetadata = parseStudentFilename(fileResult.filename);

        if (fileResult.error) {
            return {
                ...fileResult,
                ...studentMetadata,
                status: "Error",
                itemFlags: "",
                positionalScore: NaN,
                adjacentPairScore: NaN,
                pairwiseRelativeOrderScore: NaN,
                hybridLocalGlobalScore: NaN
            };
        }

        return {
            ...fileResult,
            ...studentMetadata,
            status: "OK",
            itemFlags: formatItemFlags(fileResult.result.itemComparison),
            positionalScore: fileResult.result.positionalScore,
            adjacentPairScore: fileResult.result.adjacentPairScore,
            pairwiseRelativeOrderScore: fileResult.result.pairwiseRelativeOrderScore,
            hybridLocalGlobalScore: fileResult.result.hybridLocalGlobalScore
        };
    });

    const paginatedRows = paginateRows(sortRows(rows, "students"), "students");
    panel.appendChild(createReportTable({
        view: "students",
        caption: "One row per selected student file.",
        rows: paginatedRows.items,
        pagination: paginatedRows,
        columns: [
            {
                label: "Student Name",
                sortKey: "studentName",
                render: row => row.studentName || ""
            },
            {
                label: "Canvas ID",
                sortKey: "canvasId",
                render: row => row.canvasId || ""
            },
            {
                label: "Filename",
                sortKey: "filename",
                render: row => row.filename
            },
            {
                label: "Status",
                sortKey: "status",
                render: row => row.status
            },
            {
                label: "Item Flags",
                sortKey: "itemFlags",
                render: row => row.itemFlags || "None"
            },
            {
                label: "Positional Score",
                sortKey: "positionalScore",
                render: row => formatPercent(row.positionalScore)
            },
            {
                label: "Adjacent Pair Score",
                sortKey: "adjacentPairScore",
                render: row => formatPercent(row.adjacentPairScore)
            },
            {
                label: "Pairwise Relative-Order Score",
                sortKey: "pairwiseRelativeOrderScore",
                render: row => formatPercent(row.pairwiseRelativeOrderScore)
            },
            {
                label: "Hybrid Local-Global Score",
                sortKey: "hybridLocalGlobalScore",
                render: row => formatPercent(row.hybridLocalGlobalScore)
            },
            {
                label: "Details",
                render: row => createStudentDetails(row)
            }
        ]
    }));
}

function createStudentDetails(row) {
    return createLazyDetails("View student details", details => {
        if (row.error) {
            details.appendChild(makeElement("p", "error-text", row.error));
            return;
        }

        const result = row.result;
        const list = document.createElement("dl");
        [
            ["Item Flags", formatItemFlags(result.itemComparison)],
            ["Positional Score", `${formatPercent(result.positionalScore)} (${result.positionalRaw} / ${result.itemComparison.expectedCount})`],
            ["Adjacent Pair Score", formatPercent(result.adjacentPairScore)],
            ["Pairwise Relative-Order Score", `${formatPercent(result.pairwiseRelativeOrderScore)} (${result.pairwiseRelativeOrderRaw} / ${result.pairwiseRelativeOrderTotal})`],
            ["Hybrid Local-Global Score", formatPercent(result.hybridLocalGlobalScore)]
        ].forEach(([term, description]) => {
            list.appendChild(makeElement("dt", "", term));
            list.appendChild(makeElement("dd", "", description));
        });
        details.appendChild(list);
        details.appendChild(createSelectionCountsSummary(result));
        details.appendChild(createAdditionalScoringTable(result));
    });
}

function createSelectionCountsSummary(result) {
    const section = makeElement("section", "student-detail-section");
    section.appendChild(makeElement("h4", "", "Selection Counts"));
    const list = document.createElement("dl");

    [
        ["Required present", result.required_present_count],
        ["Required omitted", result.required_omitted_count],
        ["Distractors included", result.distractor_included_count],
        ["Invalid items", result.invalid_item_count]
    ].forEach(([term, description]) => {
        list.appendChild(makeElement("dt", "", term));
        list.appendChild(makeElement("dd", "", description));
    });

    section.appendChild(list);
    return section;
}

function createAdditionalScoringTable(result) {
    const section = makeElement("section", "student-detail-section");
    section.appendChild(makeElement("h4", "", "Ordering Scores"));
    section.appendChild(createReportTable({
        rows: ADDITIONAL_SCORE_METHODS,
        columns: [
            { label: "Method", render: method => method.label },
            { label: "Raw", render: method => method.rawField ? formatScoreRaw(result, method, SCORE_VARIANT_SUFFIX) : "--" },
            { label: "Score", render: method => formatUnitScore(result[`${method.normField}_${SCORE_VARIANT_SUFFIX}`]) },
            { label: "Best Reference", render: method => result[`${method.referenceField}_${SCORE_VARIANT_SUFFIX}`] || "" }
        ]
    }));
    return section;
}
function createReportTable(options) {
    const wrapper = makeElement("div", "table-scroll");
    const table = makeElement("table", "report-table");

    if (options.caption) {
        table.appendChild(makeElement("caption", "", options.caption));
    }

    const head = document.createElement("thead");
    const headingRow = document.createElement("tr");
    options.columns.forEach(column => {
        const heading = document.createElement("th");
        heading.scope = "col";

        if (column.sortKey) {
            const button = makeElement("button", "sort-button", column.label);
            button.type = "button";
            button.dataset.sortView = options.view;
            button.dataset.sortKey = column.sortKey;

            const state = reportSortState[options.view];
            if (state?.key === column.sortKey) {
                const directionLabel = state.direction === "asc" ? "ascending" : "descending";
                heading.setAttribute("aria-sort", directionLabel);
                button.appendChild(document.createTextNode(state.direction === "asc" ? " \u25b2" : " \u25bc"));
            }

            heading.appendChild(button);
        } else {
            heading.textContent = column.label;
        }

        headingRow.appendChild(heading);
    });
    head.appendChild(headingRow);
    table.appendChild(head);

    const body = document.createElement("tbody");
    if (options.rows.length === 0) {
        const row = document.createElement("tr");
        const cell = makeElement("td", "empty-message", options.emptyMessage || "No results.");
        cell.colSpan = options.columns.length;
        row.appendChild(cell);
        body.appendChild(row);
    } else {
        options.rows.forEach(item => {
            const row = document.createElement("tr");
            options.columns.forEach(column => {
                const cell = document.createElement("td");
                appendContent(cell, column.render(item));
                row.appendChild(cell);
            });
            body.appendChild(row);
        });
    }
    table.appendChild(body);
    wrapper.appendChild(table);

    if (options.pagination?.totalPages > 1) {
        wrapper.appendChild(createPagination(options.view, options.pagination));
    }

    return wrapper;
}

function appendContent(container, content) {
    if (content instanceof Node) {
        container.appendChild(content);
        return;
    }

    container.textContent = content == null ? "" : String(content);
}

function createElementReference(label, text) {
    const reference = makeElement("div", "element-reference");
    reference.appendChild(makeElement("strong", "element-label", label));
    reference.appendChild(makeElement("span", "element-text compact-element-text", text));
    return reference;
}

function createFullReference(label, text) {
    const reference = makeElement("div", "full-reference");
    reference.appendChild(makeElement("strong", "element-label", label));
    reference.appendChild(makeElement("p", "full-element-text", text));
    return reference;
}

function createDetails(summaryText) {
    const details = makeElement("details", "report-details");
    details.appendChild(makeElement("summary", "", summaryText));
    return details;
}

function createLazyDetails(summaryText, renderContents) {
    const details = createDetails(summaryText);
    details.addEventListener("toggle", () => {
        if (!details.open || details.dataset.loaded === "true") {
            return;
        }

        details.dataset.loaded = "true";
        renderContents(details);
    });
    return details;
}

function makeElement(tagName, className, text) {
    const element = document.createElement(tagName);

    if (className) {
        element.className = className;
    }

    if (text != null) {
        element.textContent = text;
    }

    return element;
}

function formatPercent(value) {
    return Number.isFinite(value) ? `${SequencerCore.formatNumber(value)}%` : "N/A";
}

function formatUnitScore(value) {
    return Number.isFinite(value) ? SequencerCore.formatNumber(value, 3) : "N/A";
}

function formatScoreRaw(result, method, suffix) {
    const raw = result[`${method.rawField}_${suffix}`];

    if (!Number.isFinite(raw)) {
        return "N/A";
    }

    const formattedRaw = Number.isInteger(raw)
        ? SequencerCore.formatNumber(raw, 0)
        : SequencerCore.formatNumber(raw);

    if (!method.totalField) {
        return formattedRaw;
    }

    const total = result[`${method.totalField}_${suffix}`];
    return Number.isFinite(total)
        ? `${formattedRaw} / ${SequencerCore.formatNumber(total, 0)}`
        : formattedRaw;
}

function formatCountRate(count, total, rate = total > 0 ? count / total * 100 : NaN) {
    return Number.isFinite(rate)
        ? `${SequencerCore.formatNumber(rate)}% (${count}/${total})`
        : `N/A (${count}/${total})`;
}

function sortRows(rows, view) {
    const state = reportSortState[view];

    if (!state) {
        return [...rows];
    }

    const direction = state.direction === "asc" ? 1 : -1;
    return [...rows].sort((first, second) => {
        const firstValue = first[state.key];
        const secondValue = second[state.key];
        const firstMissing = firstValue == null || (typeof firstValue === "number" && !Number.isFinite(firstValue));
        const secondMissing = secondValue == null || (typeof secondValue === "number" && !Number.isFinite(secondValue));

        if (firstMissing && secondMissing) {
            return 0;
        }

        if (firstMissing) {
            return 1;
        }

        if (secondMissing) {
            return -1;
        }

        if (typeof firstValue === "number" && typeof secondValue === "number") {
            return (firstValue - secondValue) * direction;
        }

        return String(firstValue).localeCompare(String(secondValue), undefined, {
            numeric: true,
            sensitivity: "base"
        }) * direction;
    });
}

function paginateRows(rows, view) {
    const totalPages = Math.max(1, Math.ceil(rows.length / REPORT_PAGE_SIZE));
    const page = Math.min(Math.max(reportPageState[view] || 1, 1), totalPages);
    reportPageState[view] = page;
    const startIndex = (page - 1) * REPORT_PAGE_SIZE;

    return {
        items: rows.slice(startIndex, startIndex + REPORT_PAGE_SIZE),
        page,
        totalPages,
        totalRows: rows.length,
        start: rows.length === 0 ? 0 : startIndex + 1,
        end: Math.min(startIndex + REPORT_PAGE_SIZE, rows.length)
    };
}

function createPagination(view, pagination) {
    const navigation = makeElement("nav", "pagination");
    navigation.setAttribute("aria-label", `${view} table pages`);
    navigation.appendChild(makeElement(
        "span",
        "pagination-status",
        `Showing ${pagination.start}-${pagination.end} of ${pagination.totalRows}`
    ));

    const previous = makeElement("button", "", "Previous");
    previous.type = "button";
    previous.dataset.pageView = view;
    previous.dataset.page = String(pagination.page - 1);
    previous.disabled = pagination.page === 1;
    navigation.appendChild(previous);

    navigation.appendChild(makeElement("span", "pagination-status", `Page ${pagination.page} of ${pagination.totalPages}`));

    const next = makeElement("button", "", "Next");
    next.type = "button";
    next.dataset.pageView = view;
    next.dataset.page = String(pagination.page + 1);
    next.disabled = pagination.page === pagination.totalPages;
    navigation.appendChild(next);
    return navigation;
}

function updatePage(view, page) {
    reportPageState[view] = page;

    if (view === "elements") {
        renderElements();
    } else if (view === "relationships") {
        renderRelationships();
    } else if (view === "students") {
        renderStudentResults();
    } else {
        renderExclusions();
    }
}

function updateSort(view, key) {
    const current = reportSortState[view];
    const descendingByDefault = /rate|score|students|relationships|count/i.test(key);

    if (current?.key === key) {
        current.direction = current.direction === "asc" ? "desc" : "asc";
    } else {
        reportSortState[view] = {
            key,
            direction: descendingByDefault ? "desc" : "asc"
        };
    }
    reportPageState[view] = 1;

    if (view === "elements") {
        renderElements();
    } else if (view === "relationships") {
        renderRelationships();
    } else if (view === "students") {
        renderStudentResults();
    } else {
        renderExclusions();
    }
}

function formatItemFlags(itemComparison) {
    if (!itemComparison || !itemComparison.hasFlags) {
        return "None";
    }

    const flags = [];

    if (itemComparison.missingItems.length > 0) {
        flags.push(`Missing: ${itemComparison.missingItems.join("; ")}`);
    }

    if (itemComparison.extraItems.length > 0) {
        flags.push(`Extra: ${itemComparison.extraItems.join("; ")}`);
    }

    if (itemComparison.duplicateItems.length > 0) {
        flags.push(`Duplicates: ${itemComparison.duplicateItems.join("; ")}`);
    }

    return flags.join(" | ");
}

function convertResultToRow(fileResult) {
    const studentMetadata = parseStudentFilename(fileResult.filename);

    if (fileResult.error) {
        return {
            studentName: studentMetadata.studentName,
            canvasId: studentMetadata.canvasId,
            filename: fileResult.filename,
            status: "Error",
            error: fileResult.error,
            itemFlags: "",
            expectedCount: "",
            submittedCount: "",
            missingCount: "",
            missingItems: "",
            extraCount: "",
            extraItems: "",
            duplicateCount: "",
            duplicateItems: "",
            positionalRaw: "",
            positionalScore: "",
            adjacentPairScore: "",
            pairwiseRelativeOrderRaw: "",
            pairwiseRelativeOrderTotal: "",
            pairwiseRelativeOrderScore: "",
            hybridLocalGlobalScore: "",
            required_present_count: "",
            required_omitted_count: "",
            distractor_included_count: "",
            invalid_item_count: "",
            best_reference_id: "",
            best_reference_score_by_method: "",
            ...createBlankAdditionalScoreExportFields()
        };
    }

    const result = fileResult.result;
    const itemComparison = result.itemComparison;
    return {
        studentName: studentMetadata.studentName,
        canvasId: studentMetadata.canvasId,
        filename: fileResult.filename,
        status: "OK",
        error: "",
        itemFlags: formatItemFlags(itemComparison),
        expectedCount: itemComparison.expectedCount,
        submittedCount: itemComparison.submittedCount,
        missingCount: itemComparison.missingCount,
        missingItems: itemComparison.missingItems.join("; "),
        extraCount: itemComparison.extraCount,
        extraItems: itemComparison.extraItems.join("; "),
        duplicateCount: itemComparison.duplicateCount,
        duplicateItems: itemComparison.duplicateItems.join("; "),
        positionalRaw: result.positionalRaw,
        positionalScore: SequencerCore.formatNumber(result.positionalScore),
        adjacentPairScore: SequencerCore.formatNumber(result.adjacentPairScore),
        pairwiseRelativeOrderRaw: result.pairwiseRelativeOrderRaw,
        pairwiseRelativeOrderTotal: result.pairwiseRelativeOrderTotal,
        pairwiseRelativeOrderScore: SequencerCore.formatNumber(result.pairwiseRelativeOrderScore),
        hybridLocalGlobalScore: SequencerCore.formatNumber(result.hybridLocalGlobalScore),
        required_present_count: result.required_present_count,
        required_omitted_count: result.required_omitted_count,
        distractor_included_count: result.distractor_included_count,
        invalid_item_count: result.invalid_item_count,
        best_reference_id: result.best_reference_id,
        best_reference_score_by_method: JSON.stringify(result.best_reference_score_by_method || {}),
        ...createAdditionalScoreExportFields(result)
    };
}

function createBlankAdditionalScoreExportFields() {
    return Object.fromEntries(ADDITIONAL_SCORE_EXPORT_FIELDS.map(field => [field, ""]));
}

function createAdditionalScoreExportFields(result) {
    const fields = {};

    ADDITIONAL_SCORE_EXPORT_FIELDS.forEach(field => {
        const value = result[field];

        if (typeof value === "number") {
            if (!Number.isFinite(value)) {
                fields[field] = "";
            } else if (field.includes("_norm_")) {
                fields[field] = SequencerCore.formatNumber(value, 3);
            } else if (Number.isInteger(value)) {
                fields[field] = SequencerCore.formatNumber(value, 0);
            } else {
                fields[field] = SequencerCore.formatNumber(value);
            }
            return;
        }

        fields[field] = value || "";
    });

    return fields;
}

function createOverviewExportRows() {
    const invalidCount = processedFileResults.filter(fileResult => fileResult.error).length;
    const summary = classReport.scoreSummary;
    const referenceFiles = classReport.referenceFiles || [];

    return [
        { metric: "Report name", value: referenceFileNameRoot },
        { metric: "Diagnostic reference file", value: classReport.diagnosticReferenceFileName || referenceFileNameRoot },
        { metric: "Scoring reference files", value: referenceFiles.length || 1 },
        { metric: "Scoring reference variants", value: classReport.scoringReferenceCount || 1 },
        { metric: "Reference files used for scoring", value: referenceFiles.map(reference => reference.filename).join("; ") || referenceFileNameRoot },
        { metric: "Valid submissions", value: classReport.submissionCount },
        { metric: "Invalid files", value: invalidCount },
        { metric: "Sequence elements", value: classReport.elementCount },
        { metric: "Distractor elements", value: classReport.distractorCount },
        { metric: "Key confusion hotspots", value: classReport.confusionHotspots.length },
        { metric: "Pairwise reversal baseline", value: `${SequencerCore.formatNumber(classReport.overallRelationshipErrorRate)}%` },
        { metric: "Total pairwise ordering errors", value: classReport.totalRelationshipErrors },
        { metric: "Total eligible pairwise comparisons", value: classReport.totalEligibleRelationships },
        { metric: "Ordering confusion segments", value: classReport.sequenceSegments.length },
        { metric: "Broad sequence confusion ranges", value: classReport.broadSequenceConfusion.length },
        { metric: "Isolated relationship errors", value: classReport.isolatedRelationshipErrors.length },
        { metric: "Relationship reporting threshold", value: `${classReport.relationshipErrorThreshold}%` },
        { metric: "Mean pairwise relative-order score", value: SequencerCore.formatNumber(summary.pairwiseMean) },
        { metric: "Median pairwise relative-order score", value: SequencerCore.formatNumber(summary.pairwiseMedian) },
        { metric: "Mean adjacent pair score", value: SequencerCore.formatNumber(summary.adjacentMean) },
        { metric: "Median adjacent pair score", value: SequencerCore.formatNumber(summary.adjacentMedian) },
        { metric: "Mean hybrid local-global score", value: SequencerCore.formatNumber(summary.hybridMean) },
        { metric: "Median hybrid local-global score", value: SequencerCore.formatNumber(summary.hybridMedian) },
        { metric: "Submissions with missing elements", value: summary.submissionsWithMissingItems },
        { metric: "Submissions with extra elements", value: summary.submissionsWithExtraItems },
        { metric: "Submissions with duplicate elements", value: summary.submissionsWithDuplicateItems }
    ];
}

function createHotspotExportRows() {
    const rows = [];

    classReport.confusionHotspots.forEach(hotspot => {
        rows.push({
            rowType: "Hotspot summary",
            hotspotRank: hotspot.hotspotRank,
            startElementLabel: hotspot.startLabel,
            endElementLabel: hotspot.endLabel,
            elementLabels: hotspot.elements.map(element => element.label).join("; "),
            elementTexts: hotspot.elements.map(element => element.text).join("; "),
            relatedElementLabels: "",
            relatedElementTexts: "",
            observedOrder: "",
            patternDescription: "",
            reversedComparisons: hotspot.reversedComparisons,
            eligibleComparisons: hotspot.eligibleComparisons,
            pairwiseErrorRate: SequencerCore.formatNumber(hotspot.pairwiseErrorRate),
            baselineErrorRate: SequencerCore.formatNumber(hotspot.baselineErrorRate),
            excessRate: SequencerCore.formatNumber(hotspot.excessRate),
            impactRate: SequencerCore.formatNumber(hotspot.impactRate),
            affectedStudents: hotspot.affectedStudents,
            eligibleStudents: hotspot.eligibleStudents,
            affectedRate: SequencerCore.formatNumber(hotspot.affectedRate),
            priorityScore: SequencerCore.formatNumber(hotspot.priorityScore)
        });

        hotspot.topRelationships.forEach(relationship => {
            rows.push({
                rowType: "Relationship evidence",
                hotspotRank: hotspot.hotspotRank,
                startElementLabel: hotspot.startLabel,
                endElementLabel: hotspot.endLabel,
                elementLabels: hotspot.elements.map(element => element.label).join("; "),
                elementTexts: hotspot.elements.map(element => element.text).join("; "),
                relatedElementLabels: `${relationship.firstLabel}; ${relationship.secondLabel}`,
                relatedElementTexts: `${relationship.firstText}; ${relationship.secondText}`,
                observedOrder: `${relationship.secondLabel} before ${relationship.firstLabel}`,
                patternDescription: `Expected ${relationship.firstLabel} before ${relationship.secondLabel}`,
                reversedComparisons: relationship.reversedStudents,
                eligibleComparisons: relationship.eligibleStudents,
                pairwiseErrorRate: SequencerCore.formatNumber(relationship.reversalRate),
                baselineErrorRate: SequencerCore.formatNumber(hotspot.baselineErrorRate),
                excessRate: SequencerCore.formatNumber(relationship.reversalRate - hotspot.baselineErrorRate),
                impactRate: SequencerCore.formatNumber(calculateExportImpactRate(relationship.reversedStudents)),
                affectedStudents: "",
                eligibleStudents: "",
                affectedRate: "",
                priorityScore: ""
            });
        });

        hotspot.commonIncorrectOrders.forEach(pattern => {
            rows.push({
                rowType: "Common relative order",
                hotspotRank: hotspot.hotspotRank,
                startElementLabel: hotspot.startLabel,
                endElementLabel: hotspot.endLabel,
                elementLabels: hotspot.elements.map(element => element.label).join("; "),
                elementTexts: hotspot.elements.map(element => element.text).join("; "),
                relatedElementLabels: "",
                relatedElementTexts: "",
                observedOrder: pattern.labels.join(" -> "),
                patternDescription: pattern.description,
                reversedComparisons: "",
                eligibleComparisons: "",
                pairwiseErrorRate: "",
                baselineErrorRate: "",
                excessRate: "",
                impactRate: "",
                affectedStudents: pattern.count,
                eligibleStudents: hotspot.eligibleStudents,
                affectedRate: SequencerCore.formatNumber(pattern.rate),
                priorityScore: ""
            });
        });
    });

    return rows;
}

function calculateExportImpactRate(count) {
    return classReport.totalRelationshipErrors > 0
        ? count / classReport.totalRelationshipErrors * 100
        : NaN;
}

function createSequenceSegmentExportRows() {
    const rows = [];
    const segmentNumberByStartIndex = getSequenceSegmentNumberByStartIndex();

    classReport.sequenceSegments.forEach(segment => {
        const segmentNumber = segmentNumberByStartIndex.get(segment.startIndex);
        rows.push({
            category: "Ordering confusion segment",
            findingLabel: `Segment ${segmentNumber}`,
            startElementLabel: segment.startLabel,
            endElementLabel: segment.endLabel,
            elementLabels: segment.elements.map(element => element.label).join("; "),
            elementTexts: segment.elements.map(element => element.text).join("; "),
            observedOrder: "",
            patternDescription: "",
            relatedElementLabels: "",
            relatedElementTexts: "",
            count: segment.affectedStudents,
            denominator: segment.eligibleStudents,
            rate: SequencerCore.formatNumber(segment.affectedRate)
        });

        segment.commonIncorrectOrders.forEach(pattern => {
            rows.push({
                category: "Common incorrect relative order",
                findingLabel: `Segment ${segmentNumber}`,
                startElementLabel: segment.startLabel,
                endElementLabel: segment.endLabel,
                elementLabels: segment.elements.map(element => element.label).join("; "),
                elementTexts: segment.elements.map(element => element.text).join("; "),
                observedOrder: pattern.labels.join(" -> "),
                patternDescription: pattern.description,
                relatedElementLabels: "",
                relatedElementTexts: "",
                count: pattern.count,
                denominator: segment.eligibleStudents,
                rate: SequencerCore.formatNumber(pattern.rate)
            });
        });

        segment.frequentRelationships.forEach(relationship => {
            rows.push({
                category: "Segment relationship evidence",
                findingLabel: `Segment ${segmentNumber}`,
                startElementLabel: segment.startLabel,
                endElementLabel: segment.endLabel,
                elementLabels: segment.elements.map(element => element.label).join("; "),
                elementTexts: segment.elements.map(element => element.text).join("; "),
                observedOrder: `${relationship.secondLabel} before ${relationship.firstLabel}`,
                patternDescription: `Expected ${relationship.firstLabel} before ${relationship.secondLabel}`,
                relatedElementLabels: `${relationship.firstLabel}; ${relationship.secondLabel}`,
                relatedElementTexts: `${relationship.firstText}; ${relationship.secondText}`,
                count: relationship.reversedStudents,
                denominator: relationship.eligibleStudents,
                rate: SequencerCore.formatNumber(relationship.reversalRate)
            });
        });
    });

    classReport.broadSequenceConfusion.forEach((finding, index) => {
        rows.push({
            category: "Broad sequence confusion",
            findingLabel: `Broad range ${index + 1}`,
            startElementLabel: finding.startLabel,
            endElementLabel: finding.endLabel,
            elementLabels: finding.elements.map(element => element.label).join("; "),
            elementTexts: finding.elements.map(element => element.text).join("; "),
            observedOrder: "",
            patternDescription: "",
            relatedElementLabels: "",
            relatedElementTexts: "",
            count: finding.affectedStudents,
            denominator: finding.eligibleStudents,
            rate: SequencerCore.formatNumber(finding.affectedRate)
        });
    });

    classReport.isolatedRelationshipErrors.forEach(relationship => {
        rows.push({
            category: "Isolated relationship error",
            findingLabel: `${relationship.firstLabel} before ${relationship.secondLabel}`,
            startElementLabel: relationship.firstLabel,
            endElementLabel: relationship.secondLabel,
            elementLabels: `${relationship.firstLabel}; ${relationship.secondLabel}`,
            elementTexts: `${relationship.firstText}; ${relationship.secondText}`,
            observedOrder: `${relationship.secondLabel} before ${relationship.firstLabel}`,
            patternDescription: `Expected ${relationship.firstLabel} before ${relationship.secondLabel}`,
            relatedElementLabels: `${relationship.firstLabel}; ${relationship.secondLabel}`,
            relatedElementTexts: `${relationship.firstText}; ${relationship.secondText}`,
            count: relationship.reversedStudents,
            denominator: relationship.eligibleStudents,
            rate: SequencerCore.formatNumber(relationship.reversalRate)
        });
    });

    return rows;
}

function createElementExportRows() {
    return classReport.elements.map(element => ({
        elementLabel: element.label,
        elementText: element.text,
        eligibleStudents: element.eligibleStudents,
        affectedStudents: element.affectedStudents,
        affectedRate: SequencerCore.formatNumber(element.affectedRate),
        relationshipErrors: element.relationshipErrors,
        eligibleRelationships: element.eligibleRelationships,
        relationshipErrorRate: SequencerCore.formatNumber(element.relationshipErrorRate),
        tooEarlyStudents: element.tooEarlyStudents,
        tooEarlyEligibleStudents: element.tooEarlyEligibleStudents,
        tooEarlyRate: SequencerCore.formatNumber(element.tooEarlyRate),
        tooLateStudents: element.tooLateStudents,
        tooLateEligibleStudents: element.tooLateEligibleStudents,
        tooLateRate: SequencerCore.formatNumber(element.tooLateRate),
        missingStudents: element.missingStudents,
        missingRate: SequencerCore.formatNumber(element.missingRate),
        duplicateStudents: element.duplicateStudents,
        duplicateRate: SequencerCore.formatNumber(element.duplicateRate)
    }));
}

function createRelationshipExportRows() {
    return classReport.relationships.map(relationship => ({
        firstElementLabel: relationship.firstLabel,
        firstElementText: relationship.firstText,
        secondElementLabel: relationship.secondLabel,
        secondElementText: relationship.secondText,
        isImmediateRelationship: relationship.isImmediate,
        eligibleStudents: relationship.eligibleStudents,
        reversedStudents: relationship.reversedStudents,
        reversalRate: SequencerCore.formatNumber(relationship.reversalRate),
        immediateCorrectStudents: relationship.isImmediate ? relationship.immediateCorrectStudents : "",
        immediateCorrectRate: relationship.isImmediate ? SequencerCore.formatNumber(relationship.immediateCorrectRate) : ""
    }));
}

function createExclusionExportRows() {
    const rows = [];

    classReport.distractors.forEach(distractor => {
        rows.push({
            category: "Distractor retained",
            elementLabel: distractor.label,
            elementText: distractor.text,
            relatedElementLabel: "",
            relatedElementText: "",
            count: distractor.retainedStudents,
            denominator: classReport.submissionCount,
            rate: SequencerCore.formatNumber(distractor.retentionRate),
            detail: distractor.commonPlacement
        });

        distractor.placements.forEach(placement => {
            rows.push({
                category: "Distractor placement",
                elementLabel: distractor.label,
                elementText: distractor.text,
                relatedElementLabel: [placement.beforeLabel, placement.afterLabel].filter(Boolean).join("; "),
                relatedElementText: [placement.beforeText, placement.afterText].filter(Boolean).join("; "),
                count: placement.count,
                denominator: distractor.retainedStudents,
                rate: SequencerCore.formatNumber(placement.rateAmongRetained),
                detail: placement.description
            });
        });

        distractor.possibleSubstitutions.forEach(substitution => {
            rows.push({
                category: "Possible substitution",
                elementLabel: distractor.label,
                elementText: distractor.text,
                relatedElementLabel: substitution.omittedElementLabel,
                relatedElementText: substitution.omittedElementText,
                count: substitution.count,
                denominator: classReport.submissionCount,
                rate: SequencerCore.formatNumber(substitution.rate),
                detail: `${distractor.label} retained while ${substitution.omittedElementLabel} omitted`
            });
        });
    });

    classReport.omittedElements.forEach(item => {
        rows.push({
            category: "Correct element omitted",
            elementLabel: item.label,
            elementText: item.text,
            relatedElementLabel: "",
            relatedElementText: "",
            count: item.count,
            denominator: classReport.submissionCount,
            rate: SequencerCore.formatNumber(item.rate),
            detail: ""
        });
    });

    classReport.unknownExtras.forEach(item => {
        rows.push({
            category: "Unknown extra element",
            elementLabel: "",
            elementText: item.text,
            relatedElementLabel: "",
            relatedElementText: "",
            count: item.count,
            denominator: classReport.submissionCount,
            rate: SequencerCore.formatNumber(item.rate),
            detail: ""
        });
    });

    classReport.duplicates.forEach(item => {
        rows.push({
            category: "Duplicated element",
            elementLabel: item.label,
            elementText: item.text,
            relatedElementLabel: "",
            relatedElementText: "",
            count: item.count,
            denominator: classReport.submissionCount,
            rate: SequencerCore.formatNumber(item.rate),
            detail: item.kind
        });
    });

    return rows;
}

function createAdjacencyTransitionExportRows() {
    return (classReport.adjacencyTransitions || []).map(transition => ({
        firstElementLabel: transition.firstLabel,
        firstElementText: transition.firstText,
        secondElementLabel: transition.secondLabel,
        secondElementText: transition.secondText,
        isReferenceNext: transition.isReferenceNext,
        adjacentStudents: transition.adjacentStudents,
        eligibleStudents: transition.eligibleStudents,
        adjacencyRate: SequencerCore.formatNumber(transition.adjacencyRate)
    }));
}

function createPrecedenceCorrectnessExportRows() {
    return classReport.relationships.map(relationship => {
        const correctStudents = relationship.eligibleStudents - relationship.reversedStudents;
        const correctRate = relationship.eligibleStudents > 0
            ? correctStudents / relationship.eligibleStudents * 100
            : NaN;

        return {
            firstElementLabel: relationship.firstLabel,
            firstElementText: relationship.firstText,
            secondElementLabel: relationship.secondLabel,
            secondElementText: relationship.secondText,
            correctStudents,
            eligibleStudents: relationship.eligibleStudents,
            correctRate: SequencerCore.formatNumber(correctRate),
            reversedStudents: relationship.reversedStudents,
            reversalRate: SequencerCore.formatNumber(relationship.reversalRate)
        };
    });
}

function createAdjacencyHeatMapMatrixRows() {
    const transitionByIndexes = new Map((classReport.adjacencyTransitions || []).map(transition => [
        heatMapPairKey(transition.firstIndex, transition.secondIndex),
        transition
    ]));

    return classReport.elements.map(first => {
        const row = {
            rowElementLabel: first.label,
            rowElementText: first.text
        };

        classReport.elements.forEach(second => {
            if (first.index === second.index) {
                row[second.label] = "";
                return;
            }

            const transition = transitionByIndexes.get(heatMapPairKey(first.index, second.index));
            row[second.label] = formatMatrixRate(transition?.adjacencyRate);
        });

        return row;
    });
}

function createPrecedenceHeatMapMatrixRows() {
    const relationshipByIndexes = new Map(classReport.relationships.map(relationship => [
        heatMapPairKey(relationship.firstIndex, relationship.secondIndex),
        relationship
    ]));

    return classReport.elements.map(first => {
        const row = {
            rowElementLabel: first.label,
            rowElementText: first.text
        };

        classReport.elements.forEach(second => {
            if (first.index >= second.index) {
                row[second.label] = "";
                return;
            }

            const relationship = relationshipByIndexes.get(heatMapPairKey(first.index, second.index));
            const correctStudents = relationship
                ? relationship.eligibleStudents - relationship.reversedStudents
                : NaN;
            const correctRate = relationship?.eligibleStudents > 0
                ? correctStudents / relationship.eligibleStudents * 100
                : NaN;

            row[second.label] = formatMatrixRate(correctRate);
        });

        return row;
    });
}

function formatMatrixRate(rate) {
    return Number.isFinite(rate) ? SequencerCore.formatNumber(rate) : "";
}

function createDominantPatternExportRows() {
    const rows = [];

    getDominantPatternCandidates().forEach(candidate => {
        candidate.patterns.forEach(pattern => {
            rows.push({
                findingLabel: candidate.label,
                expectedOrder: candidate.finding.expectedLabels.join("; "),
                observedOrder: pattern.labels.join("; "),
                patternDescription: pattern.description,
                count: pattern.count,
                affectedStudents: candidate.affectedStudents,
                rateAmongAffected: SequencerCore.formatNumber(
                    candidate.affectedStudents > 0 ? pattern.count / candidate.affectedStudents * 100 : NaN
                ),
                plottedPatternCoverage: SequencerCore.formatNumber(candidate.coverageRate)
            });
        });

        if (candidate.otherCount > 0) {
            rows.push({
                findingLabel: candidate.label,
                expectedOrder: candidate.finding.expectedLabels.join("; "),
                observedOrder: "Other",
                patternDescription: "Other lower-frequency orders",
                count: candidate.otherCount,
                affectedStudents: candidate.affectedStudents,
                rateAmongAffected: SequencerCore.formatNumber(
                    candidate.affectedStudents > 0 ? candidate.otherCount / candidate.affectedStudents * 100 : NaN
                ),
                plottedPatternCoverage: SequencerCore.formatNumber(candidate.coverageRate)
            });
        }
    });

    return rows;
}

function convertToCSV(objArray) {
    const array = typeof objArray !== "object" ? JSON.parse(objArray) : objArray;

    if (!Array.isArray(array) || array.length === 0) {
        return "";
    }

    const headers = Object.keys(array[0]);
    const rows = [
        headers.map(escapeCsvValue).join(","),
        ...array.map(row => headers.map(header => escapeCsvValue(row[header])).join(","))
    ];

    return `${rows.join("\r\n")}\r\n`;
}

function escapeCsvValue(value) {
    let text = value == null ? "" : String(value);

    if (typeof value === "string" && /^[=+\-@]/.test(text)) {
        text = `'${text}`;
    }

    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.style.display = "none";
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
}

async function exportClassReport() {
    if (isProcessing || !classReport) {
        return;
    }

    if (typeof JSZip === "undefined") {
        alert("The report export library did not load. Check your internet connection and reload this page.");
        return;
    }

    const button = document.getElementById("export-report-button");
    button.disabled = true;
    button.textContent = "Exporting...";

    try {
        const zip = new JSZip();
        const includeInvalid = document.getElementById("include-invalid-files").checked;
        const studentRows = includeInvalid
            ? allResults
            : allResults.filter(row => row.status !== "Error");

        zip.file("class_overview.csv", convertToCSV(createOverviewExportRows()));
        zip.file("confusion_hotspots.csv", convertToCSV(createHotspotExportRows()));
        zip.file("sequence_segments.csv", convertToCSV(createSequenceSegmentExportRows()));
        zip.file("element_confusion.csv", convertToCSV(createElementExportRows()));
        zip.file("relationship_errors.csv", convertToCSV(createRelationshipExportRows()));
        zip.file("adjacency_transitions.csv", convertToCSV(createAdjacencyTransitionExportRows()));
        zip.file("adjacency_heatmap_matrix.csv", convertToCSV(createAdjacencyHeatMapMatrixRows()));
        zip.file("precedence_correctness.csv", convertToCSV(createPrecedenceCorrectnessExportRows()));
        zip.file("precedence_heatmap_matrix.csv", convertToCSV(createPrecedenceHeatMapMatrixRows()));
        zip.file("most_common_reordered_sequences.csv", convertToCSV(createDominantPatternExportRows()));
        zip.file("exclusion_errors.csv", convertToCSV(createExclusionExportRows()));
        zip.file("student_results.csv", convertToCSV(studentRows));

        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${referenceFileNameRoot}_class_report.zip`);
        announceAnalysisStatus(`Class report export started as ${referenceFileNameRoot}_class_report.zip.`);
    } catch (error) {
        console.error("Error exporting class report:", error);
        alert("The class report could not be exported.");
    } finally {
        button.textContent = "Export Report";
        updateAnalyzeButtons();
    }
}

function printClassReport() {
    if (!classReport) {
        return;
    }

    [
        "elements-panel",
        "relationships-panel",
        "visual-patterns-panel",
        "exclusions-panel",
        "student-results-panel"
    ].forEach(ensureReportPanelRendered);
    window.print();
}
