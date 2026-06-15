// Builds individual scores and an aggregate class diagnostic report.

let allResults = [];
let processedFileResults = [];
let classReport = null;
let referenceFileNameRoot = "";
let isProcessing = false;
let renderedReportPanels = new Set();

const REPORT_PAGE_SIZE = 100;
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

document.addEventListener("DOMContentLoaded", function() {
    SequencerUI.setupDropZone({
        dropZoneId: "referenceFileDropZone",
        inputId: "reference-file",
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

    const referenceFile = document.getElementById("reference-file").files[0];
    const sequenceFiles = Array.from(document.getElementById("sequence-files").files);

    if (!referenceFile || sequenceFiles.length === 0) {
        alert("Please select the reference and student files before generating a report.");
        return;
    }

    setProcessingState(true);
    resetReportData();
    const reportSection = document.getElementById("class-report");
    reportSection.setAttribute("aria-busy", "true");
    announceAnalysisStatus(`Processing ${sequenceFiles.length} student ${sequenceFiles.length === 1 ? "file" : "files"}.`);

    try {
        referenceFileNameRoot = getReferenceFileNameRoot(referenceFile.name);
        const referenceData = SequencerCore.normalizeReferenceData(
            SequencerCore.parseJson(await referenceFile.text(), referenceFile.name)
        );

        processedFileResults = await Promise.all(sequenceFiles.map(file => processStudentFile(file, referenceData)));
        const validResults = processedFileResults.filter(fileResult => !fileResult.error);
        classReport = SequencerCore.analyzeClass(
            referenceData,
            validResults.map(fileResult => fileResult.sequence)
        );
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

    SequencerUI.clearFileSelection("reference-file", "referenceFileDropZone", "No file selected");
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

function renderClassReport() {
    if (!classReport) {
        return;
    }

    const invalidCount = processedFileResults.filter(fileResult => fileResult.error).length;
    const summary = document.getElementById("class-report-summary");
    summary.textContent = `${referenceFileNameRoot}: ${classReport.submissionCount} valid ${classReport.submissionCount === 1 ? "submission" : "submissions"}, `
        + `${invalidCount} invalid ${invalidCount === 1 ? "file" : "files"}, `
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
    metrics.appendChild(createMetricCard("Mean precedence score", formatPercent(classReport.scoreSummary.precedenceMean)));
    metrics.appendChild(createMetricCard("Median precedence score", formatPercent(classReport.scoreSummary.precedenceMedian)));
    metrics.appendChild(createMetricCard("Mean adjacent-pair score", formatPercent(classReport.scoreSummary.adjacentMean)));
    metrics.appendChild(createMetricCard("Median adjacent-pair score", formatPercent(classReport.scoreSummary.adjacentMedian)));
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
        if (fileResult.error) {
            return {
                ...fileResult,
                status: "Error",
                itemFlags: "",
                adjacentPairScore: NaN,
                precedenceScore: NaN,
                weightedOrderScore: NaN
            };
        }

        return {
            ...fileResult,
            status: "OK",
            itemFlags: formatItemFlags(fileResult.result.itemComparison),
            adjacentPairScore: fileResult.result.adjacentPairScore,
            precedenceScore: fileResult.result.precedenceScore,
            weightedOrderScore: fileResult.result.weightedOrderScore
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
                label: "Adjacent Pair Score",
                sortKey: "adjacentPairScore",
                render: row => formatPercent(row.adjacentPairScore)
            },
            {
                label: "Precedence Pair Score",
                sortKey: "precedenceScore",
                render: row => formatPercent(row.precedenceScore)
            },
            {
                label: "Weighted Order Score",
                sortKey: "weightedOrderScore",
                render: row => formatPercent(row.weightedOrderScore)
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
            ["Points", `${result.points} / ${result.maxPoints}`],
            ["Adjacent Pair Score", formatPercent(result.adjacentPairScore)],
            ["Precedence Pair Score", `${formatPercent(result.precedenceScore)} (${result.precedencePairsCorrect} / ${result.precedencePairsTotal})`],
            ["Weighted Order Score", formatPercent(result.weightedOrderScore)]
        ].forEach(([term, description]) => {
            list.appendChild(makeElement("dt", "", term));
            list.appendChild(makeElement("dd", "", description));
        });
        details.appendChild(list);
    });
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
    if (fileResult.error) {
        return {
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
            points: "",
            maxPoints: "",
            adjacentPairScore: "",
            precedencePairsCorrect: "",
            precedencePairsTotal: "",
            precedenceScore: "",
            weightedOrderScore: ""
        };
    }

    const result = fileResult.result;
    const itemComparison = result.itemComparison;
    return {
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
        points: result.points,
        maxPoints: result.maxPoints,
        adjacentPairScore: SequencerCore.formatNumber(result.adjacentPairScore),
        precedencePairsCorrect: result.precedencePairsCorrect,
        precedencePairsTotal: result.precedencePairsTotal,
        precedenceScore: SequencerCore.formatNumber(result.precedenceScore),
        weightedOrderScore: SequencerCore.formatNumber(result.weightedOrderScore)
    };
}

function createOverviewExportRows() {
    const invalidCount = processedFileResults.filter(fileResult => fileResult.error).length;
    const summary = classReport.scoreSummary;

    return [
        { metric: "Report name", value: referenceFileNameRoot },
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
        { metric: "Mean precedence pair score", value: SequencerCore.formatNumber(summary.precedenceMean) },
        { metric: "Median precedence pair score", value: SequencerCore.formatNumber(summary.precedenceMedian) },
        { metric: "Mean adjacent pair score", value: SequencerCore.formatNumber(summary.adjacentMean) },
        { metric: "Median adjacent pair score", value: SequencerCore.formatNumber(summary.adjacentMedian) },
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
        "exclusions-panel",
        "student-results-panel"
    ].forEach(ensureReportPanelRendered);
    window.print();
}
