let sequence = [];
let distractors = [];
let startingElements = [];
let endingElements = [];

document.addEventListener("DOMContentLoaded", function() {
    SequencerUI.setupDropZone({
        dropZoneId: "buildFileDropZone",
        inputId: "buildFileInput"
    });
});

function handleStartingElementsInput(input) {
    startingElements = SequencerCore.splitLines(input);
}

function handleEndingElementsInput(input) {
    endingElements = SequencerCore.splitLines(input);
}

function handleSequenceInput(input) {
    sequence = SequencerCore.splitLines(input);
}

function handleDistractorInput(input) {
    distractors = SequencerCore.splitLines(input);
}

function readBuilderInputs() {
    handleStartingElementsInput(document.getElementById('startingElementsInput').value);
    handleSequenceInput(document.getElementById('sequenceInput').value);
    handleEndingElementsInput(document.getElementById('endingElementsInput').value);
    handleDistractorInput(document.getElementById('distractorsInput').value);
}

function sanitizeBaseFilename(filename) {
    return filename.trim().replace(/[\\/:*?"<>|]+/g, '_');
}

function validateBuildData() {
    const errors = [];

    if (sequence.length === 0) {
        errors.push("Enter at least one sequence element.");
    }

    const duplicates = SequencerCore.findDuplicateElements(startingElements, sequence, endingElements, distractors);
    if (duplicates.length > 0) {
        errors.push(`Each element must be unique. Duplicates: ${duplicates.join(", ")}`);
    }

    return errors;
}

function generateRandomizedSequence() {
    return SequencerCore.shuffleCopy(sequence.concat(distractors));
}

function saveFiles() {
    readBuilderInputs();

    const validationErrors = validateBuildData();
    if (validationErrors.length > 0) {
        alert(validationErrors.join('\n'));
        return;
    }

    if (typeof JSZip === "undefined" || typeof saveAs === "undefined") {
        alert("The file export libraries did not load. Check your internet connection and reload this page.");
        return;
    }

    const baseFilename = prompt("Enter a base filename:", "filename");
    if (!baseFilename || !sanitizeBaseFilename(baseFilename)) {
        alert("No filename entered. Operation cancelled.");
        return;
    }

    const safeBaseFilename = sanitizeBaseFilename(baseFilename);
    const zip = new JSZip();
    const randomizedSequence = generateRandomizedSequence();

    const referenceData = {
        startingElements: startingElements,
        sequence: sequence,
        endingElements: endingElements,
        distractors: distractors,
        numberOfDistractors: distractors.length
    };

    const assessmentData = {
        startingElements: startingElements,
        sequence: randomizedSequence,
        endingElements: endingElements,
        numberOfDistractors: distractors.length
    };

    zip.file(`${safeBaseFilename}_reference.seq`, JSON.stringify(referenceData));
    zip.file(`${safeBaseFilename}_assessment.seq`, JSON.stringify(assessmentData));

    zip.generateAsync({ type: "blob" }).then(content => {
        saveAs(content, `${safeBaseFilename}_sequences.zip`);
    }).catch(error => {
        console.error("Error generating sequence files:", error);
        alert("The sequence files could not be generated.");
    });
}

function openFile() {
    document.getElementById('buildFileInput').click();
}

function loadBuildFileFromInput(event) {
    const file = event.target.files[0];

    if (file) {
        loadBuildFile(file);
    }
}

function loadBuildFile(file) {
    let reader = new FileReader();
    reader.onerror = function(error) {
        console.error('Error reading file:', error);
        alert("The selected file could not be read.");
    };
    reader.onload = function(readerEvent) {
        try {
            const content = readerEvent.target.result;
            const data = SequencerCore.normalizeReferenceData(SequencerCore.parseJson(content, file.name));
            populateUI(data);
        } catch (error) {
            console.error("Error opening sequence file:", error);
            alert(error.message);
        }
    };
    reader.readAsText(file);
}

function populateUI(data) {
    const startingElementsArea = document.getElementById('startingElementsInput');
    const sequenceArea = document.getElementById('sequenceInput');
    const endingElementsArea = document.getElementById('endingElementsInput');
    const distractorsArea = document.getElementById('distractorsInput');

    // Update the UI
    startingElementsArea.value = data.startingElements.join('\n');
    sequenceArea.value = data.sequence.join('\n');
    endingElementsArea.value = data.endingElements.join('\n');
    distractorsArea.value = data.distractors.join('\n');

    // Update the global variables
    startingElements = data.startingElements;
    sequence = data.sequence;
    endingElements = data.endingElements;
    distractors = data.distractors;
}
