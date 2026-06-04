// Compares student sequence files against a reference sequence file and exports scores.

let allResults = [];
let referenceFileNameRoot = '';
let isProcessing = false;

document.addEventListener("DOMContentLoaded", function() {
    SequencerUI.setupDropZone({
        dropZoneId: "referenceFileDropZone",
        inputId: "reference-file"
    });
    SequencerUI.setupDropZone({
        dropZoneId: "studentFilesDropZone",
        inputId: "sequence-files",
        multiple: true
    });

    document.getElementById("reference-file").addEventListener("change", function() {
        clearAnalysisResults("Reference file selection changed. Previous results cleared.");
    });
    document.getElementById("sequence-files").addEventListener("change", function() {
        clearAnalysisResults("Student file selection changed. Previous results cleared.");
    });
    updateAnalyzeButtons();
});

async function processFiles() {
    if (isProcessing) {
        return;
    }

    const referenceFile = document.getElementById('reference-file').files[0];
    const sequenceFiles = Array.from(document.getElementById('sequence-files').files);

    if (!referenceFile || sequenceFiles.length === 0) {
        alert('Please select the reference and student files before processing.');
        return;
    }

    setProcessingState(true);
    allResults = [];
    const resultsList = document.getElementById('results-list');
    resultsList.replaceChildren();
    resultsList.setAttribute('aria-busy', 'true');
    announceAnalysisStatus(`Processing ${sequenceFiles.length} student ${sequenceFiles.length === 1 ? "file" : "files"}.`);

    try {
        referenceFileNameRoot = getReferenceFileNameRoot(referenceFile.name);
        const referenceData = SequencerCore.normalizeReferenceData(
            SequencerCore.parseJson(await referenceFile.text(), referenceFile.name)
        );

        const results = await Promise.all(sequenceFiles.map(file => processStudentFile(file, referenceData)));
        results.forEach(addResultToUI);
        allResults = results.map(convertResultToRow);
        const errorCount = results.filter(result => result.error).length;
        announceAnalysisStatus(
            `Processing complete. ${results.length - errorCount} ${results.length - errorCount === 1 ? "file" : "files"} scored`
            + `${errorCount > 0 ? ` and ${errorCount} ${errorCount === 1 ? "file" : "files"} reported errors` : ""}.`
        );
    } catch (error) {
        console.error("Error processing files:", error);
        announceAnalysisStatus(`Processing failed. ${error.message}`);
        alert(error.message);
    } finally {
        resultsList.setAttribute('aria-busy', 'false');
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

    const processButton = document.getElementById('process-button');
    const saveButton = document.getElementById('save-results-button');
    const clearStudentFilesButton = document.getElementById('clear-student-files-button');
    const clearAllButton = document.getElementById('clear-all-button');

    if (processButton) {
        processButton.disabled = processing;
        processButton.textContent = processing ? 'Processing...' : 'Process';
    }

    if (saveButton) {
        saveButton.disabled = processing || allResults.length === 0;
    }

    if (clearStudentFilesButton) {
        clearStudentFilesButton.disabled = processing;
    }

    if (clearAllButton) {
        clearAllButton.disabled = processing;
    }
}

function updateAnalyzeButtons() {
    setProcessingState(isProcessing);
}

function clearAnalysisResults(message) {
    allResults = [];
    document.getElementById('results-list').replaceChildren();
    updateAnalyzeButtons();

    if (message) {
        announceAnalysisStatus(message);
    }
}

function clearStudentFiles() {
    if (isProcessing) {
        return;
    }

    SequencerUI.clearFileSelection("sequence-files", "studentFilesDropZone", "No files selected");
    clearAnalysisResults("Student files and results cleared. Reference file retained.");
}

function clearAllAnalysis() {
    if (isProcessing) {
        return;
    }

    SequencerUI.clearFileSelection("reference-file", "referenceFileDropZone", "No file selected");
    SequencerUI.clearFileSelection("sequence-files", "studentFilesDropZone", "No files selected");
    referenceFileNameRoot = "";
    clearAnalysisResults("Reference file, student files, and results cleared.");
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
        .replace(/_reference\.seq$/i, '')
        .replace(/\.seq$/i, '') || 'sequencer';
}

function addResultToUI(fileResult) {
    const resultList = document.getElementById("results-list");
    const listItem = document.createElement("li");
    const title = document.createElement("strong");

    title.textContent = `Results for ${fileResult.filename}:`;
    listItem.appendChild(title);
    listItem.appendChild(document.createElement("br"));

    if (fileResult.error) {
        appendLine(listItem, "Error", fileResult.error);
        resultList.appendChild(listItem);
        return;
    }

    const result = fileResult.result;
    appendLine(listItem, "Item Flags", formatItemFlags(result.itemComparison));
    appendLine(listItem, "Points", `${result.points} / ${result.maxPoints}`);
    appendLine(listItem, "Adjacent Pair Correctness", `${SequencerCore.formatNumber(result.correctness)}%`);
    appendLine(
        listItem,
        "Precedence Pair Score",
        `${SequencerCore.formatNumber(result.precedenceScore)}% (${result.precedencePairsCorrect} / ${result.precedencePairsTotal})`
    );
    appendLine(listItem, "Weighted Order Score", `${SequencerCore.formatNumber(result.weightedOrderScore)}%`);

    if (Number.isFinite(result.spearmanRho)) {
        appendLine(listItem, "Spearman's Rho", SequencerCore.formatNumber(result.spearmanRho));
        appendLine(listItem, "Spearman Score", `${SequencerCore.formatNumber(result.spearmanScore)}%`);
        appendLine(listItem, "Geometric Mean Score", `${SequencerCore.formatNumber(result.geometricMean)}%`);
        appendLine(listItem, "Harmonic Mean Score", `${SequencerCore.formatNumber(result.harmonicMean)}%`);
        appendLine(listItem, "Min-Max Normalized Score", `${SequencerCore.formatNumber(result.minMaxNormalized)}%`);
    } else {
        appendLine(listItem, "Spearman's Rho", "N/A - requires equal-length sequences with the same unique elements.");
    }

    resultList.appendChild(listItem);
}

function appendLine(container, label, value) {
    container.appendChild(document.createTextNode(`${label}: ${value}`));
    container.appendChild(document.createElement("br"));
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
            correctness: "",
            precedencePairsCorrect: "",
            precedencePairsTotal: "",
            precedenceScore: "",
            weightedOrderScore: "",
            spearmanRho: "",
            spearmanScore: "",
            geometricMean: "",
            harmonicMean: "",
            minMaxNormalized: ""
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
        correctness: SequencerCore.formatNumber(result.correctness),
        precedencePairsCorrect: result.precedencePairsCorrect,
        precedencePairsTotal: result.precedencePairsTotal,
        precedenceScore: SequencerCore.formatNumber(result.precedenceScore),
        weightedOrderScore: SequencerCore.formatNumber(result.weightedOrderScore),
        spearmanRho: SequencerCore.formatNumber(result.spearmanRho),
        spearmanScore: SequencerCore.formatNumber(result.spearmanScore),
        geometricMean: SequencerCore.formatNumber(result.geometricMean),
        harmonicMean: SequencerCore.formatNumber(result.harmonicMean),
        minMaxNormalized: SequencerCore.formatNumber(result.minMaxNormalized)
    };
}

function convertToCSV(objArray) {
    const array = typeof objArray !== 'object' ? JSON.parse(objArray) : objArray;

    if (!Array.isArray(array) || array.length === 0) {
        return '';
    }

    const headers = Object.keys(array[0]);
    const rows = [
        headers.map(escapeCsvValue).join(','),
        ...array.map(row => headers.map(header => escapeCsvValue(row[header])).join(','))
    ];

    return `${rows.join('\r\n')}\r\n`;
}

function escapeCsvValue(value) {
    let text = value == null ? '' : String(value);

    if (typeof value === 'string' && /^[=+\-@]/.test(text)) {
        text = `'${text}`;
    }

    if (/[",\r\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }

    return text;
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

function saveResultsAsCSV() {
    if (isProcessing) {
        alert('Wait for processing to finish before saving results.');
        return;
    }

    if (allResults.length === 0) {
        alert('No results to save!');
        return;
    }

    const csvString = convertToCSV(allResults);
    const resultsFileName = `${referenceFileNameRoot}_results.csv`;
    downloadCSV(csvString, resultsFileName);
}
