(function initializeSequencerCore(root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    root.SequencerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSequencerCore() {
    "use strict";

    function splitLines(input) {
        return String(input || "")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }

    function parseJson(content, label) {
        try {
            return JSON.parse(content);
        } catch (error) {
            throw new Error(`${label} is not valid JSON.`);
        }
    }

    function getStringArray(data, fieldName, required) {
        const value = data[fieldName];

        if (value == null && !required) {
            return [];
        }

        if (!Array.isArray(value)) {
            throw new Error(`${fieldName} must be an array.`);
        }

        if (!value.every(item => typeof item === "string")) {
            throw new Error(`${fieldName} must contain only text values.`);
        }

        return value;
    }

    function normalizeReferenceData(data) {
        if (!data || typeof data !== "object") {
            throw new Error("Reference file must contain a sequence object.");
        }

        const startingElements = getStringArray(data, "startingElements", false);
        const sequence = getStringArray(data, "sequence", true);
        const endingElements = getStringArray(data, "endingElements", false);
        const distractors = getStringArray(data, "distractors", false);

        return {
            startingElements,
            sequence,
            endingElements,
            distractors,
            numberOfDistractors: distractors.length
        };
    }

    function normalizeStudentSequence(sequence) {
        if (!Array.isArray(sequence)) {
            throw new Error("Student sequence file must contain an array.");
        }

        if (!sequence.every(item => typeof item === "string")) {
            throw new Error("Student sequence file must contain only text values.");
        }

        return sequence;
    }

    function normalizeAssessmentData(data) {
        if (!data || typeof data !== "object") {
            throw new Error("Assessment file must contain a sequence object.");
        }

        const startingElements = getStringArray(data, "startingElements", false);
        const endingElements = getStringArray(data, "endingElements", false);
        const numberOfDistractors = Number(data.numberOfDistractors || 0);

        if (!Number.isInteger(numberOfDistractors) || numberOfDistractors < 0) {
            throw new Error("numberOfDistractors must be a non-negative whole number.");
        }

        let sequence;

        if (Array.isArray(data.sequence)) {
            sequence = getStringArray(data, "sequence", true);
        } else if (typeof data.sequence === "string") {
            sequence = parseJson(deobfuscateData(data.sequence), "Assessment sequence");
        } else {
            throw new Error("Assessment sequence must be an array.");
        }

        if (!Array.isArray(sequence) || !sequence.every(item => typeof item === "string")) {
            throw new Error("Assessment sequence must contain only text values.");
        }

        return {
            startingElements,
            sequence,
            endingElements,
            numberOfDistractors
        };
    }

    function findDuplicates(values) {
        const counts = new Map();

        values.forEach(value => {
            counts.set(value, (counts.get(value) || 0) + 1);
        });

        return [...counts.entries()]
            .filter(([, count]) => count > 1)
            .map(([value]) => value);
    }

    function findDuplicateElements(...groups) {
        return findDuplicates(groups.flat());
    }

    function compareExpectedItems(reference, sequence) {
        const expectedItems = new Set(reference);
        const submittedCounts = new Map();

        sequence.forEach(item => {
            submittedCounts.set(item, (submittedCounts.get(item) || 0) + 1);
        });

        const missingItems = reference.filter(item => !submittedCounts.has(item));
        const extraItems = [...submittedCounts.keys()].filter(item => !expectedItems.has(item));
        const duplicateItems = [...submittedCounts.entries()]
            .filter(([, count]) => count > 1)
            .map(([item]) => item);

        return {
            expectedCount: reference.length,
            submittedCount: sequence.length,
            missingItems,
            extraItems,
            duplicateItems,
            missingCount: missingItems.length,
            extraCount: extraItems.length,
            duplicateCount: duplicateItems.length,
            hasFlags: missingItems.length > 0 || extraItems.length > 0 || duplicateItems.length > 0
        };
    }

    function shuffleCopy(items, random = Math.random) {
        const shuffled = [...items];

        for (let index = shuffled.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function obfuscateData(data) {
        const binaryString = encodeURIComponent(data).replace(/%([0-9A-F]{2})/g, (match, byte) => {
            return String.fromCharCode(parseInt(byte, 16));
        });

        if (typeof btoa === "function") {
            return btoa(binaryString);
        }

        if (typeof Buffer !== "undefined") {
            return Buffer.from(binaryString, "binary").toString("base64");
        }

        throw new Error("Base64 encoding is not available.");
    }

    function deobfuscateData(obfuscatedData) {
        let binaryString;

        if (typeof atob === "function") {
            binaryString = atob(obfuscatedData);
        } else if (typeof Buffer !== "undefined") {
            binaryString = Buffer.from(obfuscatedData, "base64").toString("binary");
        } else {
            throw new Error("Base64 decoding is not available.");
        }

        return decodeURIComponent(
            binaryString
                .split("")
                .map(character => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
                .join("")
        );
    }

    function pairKey(first, second) {
        return JSON.stringify([first, second]);
    }

    function extractAdjacentPairs(sequence) {
        const pairs = [];

        for (let index = 0; index < sequence.length - 1; index++) {
            pairs.push([sequence[index], sequence[index + 1]]);
        }

        return pairs;
    }

    function stripFixedElements(sequence, startingElements, endingElements) {
        const fixedElements = new Set([...startingElements, ...endingElements]);
        return sequence.filter(item => !fixedElements.has(item));
    }

    function calculateAdjacentPairScore(reference, sequence) {
        const maxPoints = Math.max(reference.length - 1, 0);

        if (maxPoints === 0) {
            const isExactMatch = reference.length === sequence.length && reference.every((item, index) => item === sequence[index]);
            return {
                points: 0,
                maxPoints,
                correctness: isExactMatch ? 100 : 0
            };
        }

        const referencePairs = new Set(extractAdjacentPairs(reference).map(([first, second]) => pairKey(first, second)));
        let points = 0;

        extractAdjacentPairs(sequence).forEach(([first, second]) => {
            if (referencePairs.has(pairKey(first, second))) {
                points++;
                return;
            }

            if (referencePairs.has(pairKey(second, first))) {
                return;
            }

            points--;
        });

        const rawCorrectness = ((points + maxPoints) / (2 * maxPoints)) * 100;

        return {
            points,
            maxPoints,
            correctness: Math.max(0, Math.min(100, rawCorrectness))
        };
    }

    function calculatePrecedencePairScore(reference, sequence) {
        const totalPairs = reference.length * (reference.length - 1) / 2;

        if (reference.length === 0) {
            return {
                correctPairs: 0,
                totalPairs,
                score: sequence.length === 0 ? 100 : 0
            };
        }

        if (reference.length === 1) {
            return {
                correctPairs: sequence.includes(reference[0]) ? 1 : 0,
                totalPairs: 1,
                score: sequence.includes(reference[0]) ? 100 : 0
            };
        }

        const sequencePositions = new Map();
        sequence.forEach((item, index) => {
            if (!sequencePositions.has(item)) {
                sequencePositions.set(item, index);
            }
        });

        let correctPairs = 0;

        for (let firstIndex = 0; firstIndex < reference.length - 1; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < reference.length; secondIndex++) {
                const firstPosition = sequencePositions.get(reference[firstIndex]);
                const secondPosition = sequencePositions.get(reference[secondIndex]);

                if (
                    Number.isInteger(firstPosition) &&
                    Number.isInteger(secondPosition) &&
                    firstPosition < secondPosition
                ) {
                    correctPairs++;
                }
            }
        }

        return {
            correctPairs,
            totalPairs,
            score: totalPairs === 0 ? 100 : correctPairs / totalPairs * 100
        };
    }

    function calculateSpearmanRho(reference, sequence) {
        if (reference.length !== sequence.length) {
            return NaN;
        }

        if (reference.length === 0) {
            return 1;
        }

        if (reference.length === 1) {
            return reference[0] === sequence[0] ? 1 : NaN;
        }

        if (findDuplicates(reference).length > 0 || findDuplicates(sequence).length > 0) {
            return NaN;
        }

        const referencePositions = new Map(reference.map((item, index) => [item, index + 1]));
        const sequencePositions = new Map(sequence.map((item, index) => [item, index + 1]));

        if (referencePositions.size !== sequencePositions.size) {
            return NaN;
        }

        for (const item of referencePositions.keys()) {
            if (!sequencePositions.has(item)) {
                return NaN;
            }
        }

        const squaredDifferenceSum = reference.reduce((sum, item) => {
            const difference = referencePositions.get(item) - sequencePositions.get(item);
            return sum + difference * difference;
        }, 0);

        const n = reference.length;
        return 1 - (6 * squaredDifferenceSum) / (n * (n * n - 1));
    }

    function calculateCombinedScores(correctness, spearmanRho, precedenceScore) {
        const weightedOrderScore = Number.isFinite(precedenceScore)
            ? (correctness + precedenceScore) / 2
            : NaN;

        if (!Number.isFinite(spearmanRho)) {
            return {
                spearmanScore: NaN,
                geometricMean: NaN,
                harmonicMean: NaN,
                minMaxNormalized: NaN,
                weightedOrderScore
            };
        }

        const adjustedSpearman = (spearmanRho + 1) / 2;
        const spearmanScore = adjustedSpearman * 100;
        const geometricMean = Math.sqrt((correctness / 100) * adjustedSpearman) * 100;
        const harmonicMean = correctness + spearmanScore === 0
            ? 0
            : (2 * correctness * spearmanScore) / (correctness + spearmanScore);
        const minMaxNormalized = (correctness + spearmanScore) / 2;

        return {
            spearmanScore,
            geometricMean,
            harmonicMean,
            minMaxNormalized,
            weightedOrderScore
        };
    }

    function analyzeSequence(referenceData, studentSequence) {
        const reference = normalizeReferenceData(referenceData);
        const sequence = normalizeStudentSequence(studentSequence);
        const referenceMiddle = stripFixedElements(reference.sequence, reference.startingElements, reference.endingElements);
        const sequenceMiddle = stripFixedElements(sequence, reference.startingElements, reference.endingElements);
        const itemComparison = compareExpectedItems(referenceMiddle, sequenceMiddle);
        const adjacentPairScore = calculateAdjacentPairScore(referenceMiddle, sequenceMiddle);
        const precedencePairScore = calculatePrecedencePairScore(referenceMiddle, sequenceMiddle);
        const spearmanRho = calculateSpearmanRho(referenceMiddle, sequenceMiddle);
        const combinedScores = calculateCombinedScores(adjacentPairScore.correctness, spearmanRho, precedencePairScore.score);

        return {
            points: adjacentPairScore.points,
            maxPoints: adjacentPairScore.maxPoints,
            correctness: adjacentPairScore.correctness,
            precedencePairsCorrect: precedencePairScore.correctPairs,
            precedencePairsTotal: precedencePairScore.totalPairs,
            precedenceScore: precedencePairScore.score,
            spearmanRho,
            spearmanScore: combinedScores.spearmanScore,
            weightedOrderScore: combinedScores.weightedOrderScore,
            geometricMean: combinedScores.geometricMean,
            harmonicMean: combinedScores.harmonicMean,
            minMaxNormalized: combinedScores.minMaxNormalized,
            itemComparison
        };
    }

    function formatNumber(value, digits = 2) {
        return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
    }

    return {
        analyzeSequence,
        calculateAdjacentPairScore,
        calculatePrecedencePairScore,
        calculateSpearmanRho,
        compareExpectedItems,
        deobfuscateData,
        findDuplicateElements,
        findDuplicates,
        formatNumber,
        normalizeAssessmentData,
        normalizeReferenceData,
        normalizeStudentSequence,
        obfuscateData,
        parseJson,
        shuffleCopy,
        splitLines,
        stripFixedElements
    };
});
