let globalNumberOfDistractors = 0;
let globalFileName = "";
let sequenceSortable = null;

document.addEventListener("DOMContentLoaded", function() {
    SequencerUI.setupDropZone({
        dropZoneId: "studentFileDropZone",
        inputId: "fileInput"
    });

    if (new URLSearchParams(window.location.search).get("example") === "1") {
        loadExampleAssessment();
    }
});

function loadExampleAssessment() {
    if (!globalThis.SequencerExample) {
        return;
    }

    globalFileName = SequencerExample.assessmentFilename;
    displaySequence(JSON.stringify(SequencerExample.assessment));
    document.getElementById("example-question-prompt").textContent = SequencerExample.prompt;
    document.getElementById("example-student-notice").hidden = false;
    document.getElementById("studentFileStatus").textContent = "Built-in example assessment loaded";
}

function loadFile(event) {
    const file = event.target.files[0];
    if (file) {
        globalFileName = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const content = e.target.result;
                displaySequence(content);
            } catch (error) {
                console.error("Error loading sequence file:", error);
                alert(error.message);
            }
        };
        reader.onerror = function(error) {
            console.error("Error reading file:", error);
            alert("The selected file could not be read.");
        };
        reader.readAsText(file);
    }
}

function displaySequence(content) {
    const data = SequencerCore.normalizeAssessmentData(SequencerCore.parseJson(content, "Sequence file"));
    const decodedSequence = SequencerCore.shuffleCopy(data.sequence);

    data.startingElements = data.startingElements || [];
    data.endingElements = data.endingElements || [];

    const startingList = document.getElementById('startingList');
    const sequenceList = document.getElementById('sequenceList');
    const endingList = document.getElementById('endingList');

    startingList.replaceChildren();
    sequenceList.replaceChildren();
    endingList.replaceChildren();

    const showExcludeButton = data.numberOfDistractors > 0;
    const distractorMessageElement = document.getElementById('distractorMessage');

    if (showExcludeButton) {
        const elementWord = data.numberOfDistractors === 1 ? "element" : "elements";
        const message = `Exclude ${data.numberOfDistractors} ${elementWord}.`;
        distractorMessageElement.textContent = message;
        globalNumberOfDistractors = data.numberOfDistractors;
    } else {
        distractorMessageElement.textContent = "";
        globalNumberOfDistractors = 0;
    }

    data.startingElements.forEach(item => {
        startingList.appendChild(createSequenceItem(item, { locked: true }));
    });

    decodedSequence.forEach(item => {
        sequenceList.appendChild(createSequenceItem(item, { showExcludeButton }));
    });

    data.endingElements.forEach(item => {
        endingList.appendChild(createSequenceItem(item, { locked: true }));
    });

    initializeSortable(sequenceList);
    updateSequenceActionStates();

    const distractorStatus = data.numberOfDistractors > 0
        ? ` Exclude ${data.numberOfDistractors} ${data.numberOfDistractors === 1 ? "event" : "events"}.`
        : "";
    announceStudentStatus(`Assessment loaded. ${decodedSequence.length} events are available to order.${distractorStatus}`);
}

function createSequenceItem(item, options = {}) {
    const listItem = document.createElement('li');
    listItem.className = options.locked ? 'sequence-item locked-item' : 'sequence-item';
    listItem.dataset.sequenceLabel = item;

    if (!options.locked) {
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'button-group';
        buttonGroup.setAttribute('role', 'group');
        buttonGroup.setAttribute('aria-label', `Actions for ${item}`);

        if (options.showExcludeButton) {
            buttonGroup.appendChild(createActionButton('X', `Exclude ${item}`, excludeElement, {
                action: 'exclude',
                pressed: false
            }));
        }

        buttonGroup.appendChild(createActionButton('\u2191', `Move ${item} up`, moveUp, { action: 'move-up' }));
        buttonGroup.appendChild(createActionButton('\u2193', `Move ${item} down`, moveDown, { action: 'move-down' }));
        listItem.appendChild(buttonGroup);
    }

    const textElement = document.createElement('span');
    textElement.className = 'sequence-text';
    textElement.textContent = item;
    listItem.appendChild(textElement);

    return listItem;
}

function createActionButton(label, ariaLabel, handler, options = {}) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sequence-action-button';
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);

    if (options.action) {
        button.dataset.action = options.action;
    }

    if (typeof options.pressed === "boolean") {
        button.setAttribute('aria-pressed', String(options.pressed));
    }

    button.addEventListener('click', function() {
        handler(button);
    });

    return button;
}

function initializeSortable(sequenceList) {
    if (sequenceSortable) {
        sequenceSortable.destroy();
        sequenceSortable = null;
    }

    if (typeof Sortable === "undefined") {
        console.warn("Sortable did not load. Move buttons remain available.");
        return;
    }

    sequenceSortable = new Sortable(sequenceList, {
        animation: 150,
        filter: '.locked-item',
        onEnd: function(event) {
            updateSequenceActionStates();
            const movedItem = event.item;
            announceItemPosition(movedItem);
        }
    });
}

function excludeElement(buttonElement) {
    const listItem = buttonElement.closest('.sequence-item');
    
    if (listItem) {
        listItem.classList.toggle('excluded');
        const excluded = listItem.classList.contains('excluded');
        const item = getSequenceItemText(listItem);
        buttonElement.setAttribute('aria-pressed', String(excluded));
        buttonElement.setAttribute('aria-label', excluded ? `Include ${item}` : `Exclude ${item}`);
        announceStudentStatus(`${item} ${excluded ? "excluded" : "included"}.`);
    }
}

function moveUp(buttonElement) {
    const sequenceList = document.getElementById('sequenceList');
    const currentItem = buttonElement.closest('.sequence-item');

    if (currentItem && currentItem.previousElementSibling) {
        sequenceList.insertBefore(currentItem, currentItem.previousElementSibling);
        updateSequenceActionStates();
        announceItemPosition(currentItem);
    }
}

function moveDown(buttonElement) {
    const sequenceList = document.getElementById('sequenceList');
    const currentItem = buttonElement.closest('.sequence-item');

    if (currentItem && currentItem.nextElementSibling) {
        sequenceList.insertBefore(currentItem.nextElementSibling, currentItem);
        updateSequenceActionStates();
        announceItemPosition(currentItem);
    }
}

function updateSequenceActionStates() {
    const sequenceList = document.getElementById('sequenceList');
    const items = Array.from(sequenceList.children);

    items.forEach((listItem, index) => {
        const item = getSequenceItemText(listItem);
        const position = index + 1;
        const moveUpButton = listItem.querySelector('[data-action="move-up"]');
        const moveDownButton = listItem.querySelector('[data-action="move-down"]');
        const excludeButton = listItem.querySelector('[data-action="exclude"]');

        listItem.setAttribute('aria-posinset', String(position));
        listItem.setAttribute('aria-setsize', String(items.length));

        if (moveUpButton) {
            moveUpButton.disabled = index === 0;
            moveUpButton.setAttribute('aria-label', `Move ${item} up. Position ${position} of ${items.length}.`);
        }

        if (moveDownButton) {
            moveDownButton.disabled = index === items.length - 1;
            moveDownButton.setAttribute('aria-label', `Move ${item} down. Position ${position} of ${items.length}.`);
        }

        if (excludeButton) {
            const excluded = listItem.classList.contains('excluded');
            excludeButton.setAttribute('aria-pressed', String(excluded));
            excludeButton.setAttribute('aria-label', excluded ? `Include ${item}` : `Exclude ${item}`);
        }
    });
}

function announceItemPosition(listItem) {
    const sequenceList = document.getElementById('sequenceList');
    const items = Array.from(sequenceList.children);
    const position = items.indexOf(listItem) + 1;
    const item = getSequenceItemText(listItem);

    announceStudentStatus(`${item} moved to position ${position} of ${items.length}.`);
}

function getSequenceItemText(listItem) {
    return listItem.dataset.sequenceLabel || listItem.querySelector('.sequence-text')?.textContent || "Event";
}

function announceStudentStatus(message) {
    const status = document.getElementById('studentStatus');

    if (!status) {
        return;
    }

    status.textContent = "";
    window.setTimeout(() => {
        status.textContent = message;
    }, 10);
}

function saveSequence() {
    const sequenceList = document.getElementById('sequenceList').children;

    if (sequenceList.length === 0) {
        alert("Open a sequence file before saving.");
        return;
    }

    if (typeof saveAs === "undefined") {
        alert("The file export library did not load. Check your internet connection and reload this page.");
        return;
    }

    const items = [];
    let excludedCount = 0;

    for (const listItem of sequenceList) {
        if (listItem.classList.contains('excluded')) {
            excludedCount++;
        } else {
            const textElement = listItem.querySelector('.sequence-text');
            if (textElement) {
                items.push(textElement.textContent);
            }
        }
    }

    const expectedDistractors = globalNumberOfDistractors;
    if (expectedDistractors && excludedCount !== expectedDistractors) {
        alert(`You have excluded ${excludedCount} element(s). The starting sequence has ${expectedDistractors} element(s) that should be excluded.`);
        return;
    }

    const content = JSON.stringify(items);

    let saveFileName = getStudentFilename(globalFileName);
    const studentId = prompt("Optional: enter your unique identifier to append to the filename.", "");
    saveFileName = appendOptionalIdToFilename(saveFileName, studentId);

    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    saveAs(blob, saveFileName);
    announceStudentStatus(`Sequence download started as ${saveFileName}.`);
}

function getStudentFilename(filename) {
    if (!filename) {
        return "sequence_student.seq";
    }

    if (/_assessment\.seq$/i.test(filename)) {
        return filename.replace(/_assessment\.seq$/i, '_student.seq');
    }

    if (/\.seq$/i.test(filename)) {
        return filename.replace(/\.seq$/i, '_student.seq');
    }

    return `${filename}_student.seq`;
}

function appendOptionalIdToFilename(filename, studentId) {
    const sanitizedId = sanitizeFilenamePart(studentId || "");

    if (!sanitizedId) {
        return filename;
    }

    if (/\.seq$/i.test(filename)) {
        return filename.replace(/\.seq$/i, `_${sanitizedId}.seq`);
    }

    return `${filename}_${sanitizedId}`;
}

function sanitizeFilenamePart(value) {
    return String(value)
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[\\/:*?"<>|]+/g, "_");
}
