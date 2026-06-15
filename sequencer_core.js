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
            sequence = parseJson(decodeEncodedAssessmentSequence(data.sequence), "Assessment sequence");
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

    function countValues(values) {
        const counts = new Map();

        values.forEach(value => {
            counts.set(value, (counts.get(value) || 0) + 1);
        });

        return counts;
    }

    function calculateRate(count, total) {
        return total > 0 ? count / total * 100 : NaN;
    }

    function calculateMean(values) {
        const finiteValues = values.filter(Number.isFinite);

        if (finiteValues.length === 0) {
            return NaN;
        }

        return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
    }

    function calculateMedian(values) {
        const finiteValues = values.filter(Number.isFinite).sort((first, second) => first - second);

        if (finiteValues.length === 0) {
            return NaN;
        }

        const midpoint = Math.floor(finiteValues.length / 2);

        if (finiteValues.length % 2 === 1) {
            return finiteValues[midpoint];
        }

        return (finiteValues[midpoint - 1] + finiteValues[midpoint]) / 2;
    }

    function createAggregateRecord(map, key, initialData) {
        if (!map.has(key)) {
            map.set(key, {
                ...initialData,
                count: 0
            });
        }

        return map.get(key);
    }

    function shuffleCopy(items, random = Math.random) {
        const shuffled = [...items];

        for (let index = shuffled.length - 1; index > 0; index--) {
            const swapIndex = Math.floor(random() * (index + 1));
            [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
        }

        return shuffled;
    }

    function decodeEncodedAssessmentSequence(encodedData) {
        let binaryString;

        if (typeof atob === "function") {
            binaryString = atob(encodedData);
        } else if (typeof Buffer !== "undefined") {
            binaryString = Buffer.from(encodedData, "base64").toString("binary");
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
            const score = isExactMatch ? 100 : 0;
            return {
                points: 0,
                maxPoints,
                adjacentPairScore: score
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

        const rawScore = ((points + maxPoints) / (2 * maxPoints)) * 100;
        const score = Math.max(0, Math.min(100, rawScore));

        return {
            points,
            maxPoints,
            adjacentPairScore: score
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

    function calculateWeightedOrderScore(adjacentPairScore, precedenceScore) {
        return Number.isFinite(precedenceScore)
            ? (adjacentPairScore + precedenceScore) / 2
            : NaN;
    }

    function analyzeSequence(referenceData, studentSequence) {
        const reference = normalizeReferenceData(referenceData);
        const sequence = normalizeStudentSequence(studentSequence);
        const referenceMiddle = stripFixedElements(reference.sequence, reference.startingElements, reference.endingElements);
        const sequenceMiddle = stripFixedElements(sequence, reference.startingElements, reference.endingElements);
        const itemComparison = compareExpectedItems(referenceMiddle, sequenceMiddle);
        const adjacentPairScore = calculateAdjacentPairScore(referenceMiddle, sequenceMiddle);
        const precedencePairScore = calculatePrecedencePairScore(referenceMiddle, sequenceMiddle);
        const weightedOrderScore = calculateWeightedOrderScore(adjacentPairScore.adjacentPairScore, precedencePairScore.score);

        return {
            points: adjacentPairScore.points,
            maxPoints: adjacentPairScore.maxPoints,
            adjacentPairScore: adjacentPairScore.adjacentPairScore,
            precedencePairsCorrect: precedencePairScore.correctPairs,
            precedencePairsTotal: precedencePairScore.totalPairs,
            precedenceScore: precedencePairScore.score,
            weightedOrderScore,
            itemComparison
        };
    }

    function getConnectedRelationshipComponents(relationships, elementCount) {
        const adjacency = Array.from({ length: elementCount }, () => []);

        relationships.forEach(relationship => {
            adjacency[relationship.firstIndex].push({
                index: relationship.secondIndex,
                relationship
            });
            adjacency[relationship.secondIndex].push({
                index: relationship.firstIndex,
                relationship
            });
        });

        const visited = new Set();
        const components = [];

        for (let startIndex = 0; startIndex < elementCount; startIndex++) {
            if (visited.has(startIndex) || adjacency[startIndex].length === 0) {
                continue;
            }

            const queue = [startIndex];
            const nodes = new Set();
            const componentRelationships = new Set();
            visited.add(startIndex);

            while (queue.length > 0) {
                const currentIndex = queue.shift();
                nodes.add(currentIndex);

                adjacency[currentIndex].forEach(neighbor => {
                    componentRelationships.add(neighbor.relationship);

                    if (!visited.has(neighbor.index)) {
                        visited.add(neighbor.index);
                        queue.push(neighbor.index);
                    }
                });
            }

            components.push({
                nodeIndexes: [...nodes].sort((first, second) => first - second),
                relationships: [...componentRelationships]
            });
        }

        return components;
    }

    function mergeOverlappingRelationshipComponents(components) {
        const multiElementComponents = components
            .filter(component => component.nodeIndexes.length >= 3)
            .map(component => ({
                ...component,
                startIndex: component.nodeIndexes[0],
                endIndex: component.nodeIndexes[component.nodeIndexes.length - 1]
            }))
            .sort((first, second) => first.startIndex - second.startIndex);
        const merged = [];

        multiElementComponents.forEach(component => {
            const previous = merged[merged.length - 1];

            if (!previous || component.startIndex > previous.endIndex) {
                merged.push({
                    ...component,
                    nodeIndexes: [...component.nodeIndexes],
                    relationships: [...component.relationships]
                });
                return;
            }

            previous.endIndex = Math.max(previous.endIndex, component.endIndex);
            previous.nodeIndexes = [...new Set([...previous.nodeIndexes, ...component.nodeIndexes])]
                .sort((first, second) => first - second);
            previous.relationships = [...new Set([...previous.relationships, ...component.relationships])];
        });

        return merged;
    }

    function describeOrderingPattern(expectedLabels, submittedLabels) {
        if (submittedLabels.every((label, index) => label === expectedLabels[expectedLabels.length - 1 - index])) {
            return "Segment reversed";
        }

        const differentIndexes = expectedLabels
            .map((label, index) => label === submittedLabels[index] ? -1 : index)
            .filter(index => index >= 0);

        if (differentIndexes.length === 2) {
            const [firstIndex, secondIndex] = differentIndexes;

            if (
                secondIndex === firstIndex + 1
                && expectedLabels[firstIndex] === submittedLabels[secondIndex]
                && expectedLabels[secondIndex] === submittedLabels[firstIndex]
            ) {
                return `${expectedLabels[firstIndex]} and ${expectedLabels[secondIndex]} swapped`;
            }
        }

        return "Alternative ordering pattern";
    }

    function analyzeSequenceRange(range, elements, sequences, reference, includePatterns = true) {
        const rangeElements = elements.slice(range.startIndex, range.endIndex + 1);
        const rangeItems = new Set(rangeElements.map(element => element.text));
        const elementByText = new Map(elements.map(element => [element.text, element]));
        const expectedLabels = rangeElements.map(element => element.label);
        const expectedKey = expectedLabels.join("|");
        const patternMap = new Map();
        let eligibleStudents = 0;
        let affectedStudents = 0;

        sequences.forEach(sequence => {
            const sequenceMiddle = stripFixedElements(sequence, reference.startingElements, reference.endingElements);
            const counts = countValues(sequenceMiddle);

            if (!rangeElements.every(element => counts.get(element.text) === 1)) {
                return;
            }

            eligibleStudents++;
            const submittedLabels = sequenceMiddle
                .filter(item => rangeItems.has(item))
                .map(item => elementByText.get(item).label);
            const patternKey = submittedLabels.join("|");

            if (patternKey === expectedKey) {
                return;
            }

            affectedStudents++;
            if (includePatterns) {
                const pattern = createAggregateRecord(patternMap, patternKey, {
                    labels: submittedLabels,
                    description: describeOrderingPattern(expectedLabels, submittedLabels)
                });
                pattern.count++;
            }
        });

        return {
            startIndex: range.startIndex,
            endIndex: range.endIndex,
            startLabel: rangeElements[0].label,
            endLabel: rangeElements[rangeElements.length - 1].label,
            elements: rangeElements.map(element => ({
                index: element.index,
                label: element.label,
                text: element.text
            })),
            expectedLabels,
            eligibleStudents,
            affectedStudents,
            affectedRate: calculateRate(affectedStudents, eligibleStudents),
            commonIncorrectOrders: [...patternMap.values()]
                .map(pattern => ({
                    ...pattern,
                    rate: calculateRate(pattern.count, eligibleStudents),
                    rateAmongAffected: calculateRate(pattern.count, affectedStudents)
                }))
                .sort((first, second) => second.count - first.count)
        };
    }

    function analyzeSequenceSegments(elements, relationships, sequences, reference) {
        const relationshipErrorThreshold = 15;
        const maxSegmentElements = 6;
        const significantRelationships = relationships.filter(relationship => (
            relationship.eligibleStudents > 0
            && relationship.reversalRate >= relationshipErrorThreshold
        ));
        const localSignificantRelationships = significantRelationships.filter(relationship => (
            relationship.secondIndex - relationship.firstIndex < maxSegmentElements
        ));
        const components = getConnectedRelationshipComponents(localSignificantRelationships, elements.length);
        const multiElementComponents = mergeOverlappingRelationshipComponents(components);
        const sequenceSegments = [];
        const broadSequenceConfusion = [];

        multiElementComponents.forEach(component => {
            const rangeLength = component.endIndex - component.startIndex + 1;
            const rangeAnalysis = analyzeSequenceRange(
                component,
                elements,
                sequences,
                reference,
                rangeLength <= maxSegmentElements
            );
            const internalRelationships = significantRelationships
                .filter(relationship => (
                    relationship.firstIndex >= component.startIndex
                    && relationship.secondIndex <= component.endIndex
                ))
                .sort((first, second) => second.reversalRate - first.reversalRate);
            const finding = {
                ...rangeAnalysis,
                frequentRelationships: internalRelationships.map(relationship => ({
                    firstIndex: relationship.firstIndex,
                    secondIndex: relationship.secondIndex,
                    firstLabel: relationship.firstLabel,
                    firstText: relationship.firstText,
                    secondLabel: relationship.secondLabel,
                    secondText: relationship.secondText,
                    eligibleStudents: relationship.eligibleStudents,
                    reversedStudents: relationship.reversedStudents,
                    reversalRate: relationship.reversalRate
                }))
            };

            if (rangeLength <= maxSegmentElements) {
                sequenceSegments.push(finding);
            } else {
                broadSequenceConfusion.push(finding);
            }
        });

        const coveredRanges = [...sequenceSegments, ...broadSequenceConfusion];
        const isolatedRelationshipErrors = significantRelationships
            .filter(relationship => !coveredRanges.some(range => (
                relationship.firstIndex >= range.startIndex
                && relationship.secondIndex <= range.endIndex
            )))
            .map(relationship => ({
                firstIndex: relationship.firstIndex,
                secondIndex: relationship.secondIndex,
                firstLabel: relationship.firstLabel,
                firstText: relationship.firstText,
                secondLabel: relationship.secondLabel,
                secondText: relationship.secondText,
                eligibleStudents: relationship.eligibleStudents,
                reversedStudents: relationship.reversedStudents,
                reversalRate: relationship.reversalRate
            }))
            .sort((first, second) => second.reversalRate - first.reversalRate);

        sequenceSegments.sort((first, second) => second.affectedRate - first.affectedRate);
        broadSequenceConfusion.sort((first, second) => second.affectedRate - first.affectedRate);

        return {
            relationshipErrorThreshold,
            maxSegmentElements,
            sequenceSegments,
            broadSequenceConfusion,
            isolatedRelationshipErrors
        };
    }

    function analyzeClass(referenceData, studentSequences) {
        const reference = normalizeReferenceData(referenceData);

        if (!Array.isArray(studentSequences)) {
            throw new Error("Student sequences must be an array.");
        }

        const sequences = studentSequences.map(normalizeStudentSequence);
        const referenceMiddle = stripFixedElements(reference.sequence, reference.startingElements, reference.endingElements);
        const duplicateReferenceItems = findDuplicateElements(referenceMiddle, reference.distractors);

        if (duplicateReferenceItems.length > 0) {
            throw new Error(`Class reports require unique reference elements and distractors. Duplicates: ${duplicateReferenceItems.join(", ")}`);
        }

        const submissionCount = sequences.length;
        const expectedItems = new Set(referenceMiddle);
        const distractorItems = new Set(reference.distractors);
        const elements = referenceMiddle.map((text, index) => ({
            index,
            label: `E${index + 1}`,
            text,
            eligibleStudents: 0,
            affectedStudents: 0,
            affectedRate: NaN,
            relationshipErrors: 0,
            eligibleRelationships: 0,
            relationshipErrorRate: NaN,
            tooEarlyStudents: 0,
            tooEarlyEligibleStudents: 0,
            tooEarlyRate: NaN,
            tooLateStudents: 0,
            tooLateEligibleStudents: 0,
            tooLateRate: NaN,
            missingStudents: 0,
            missingRate: NaN,
            duplicateStudents: 0,
            duplicateRate: NaN,
            relationshipErrorsDetail: [],
            immediateRelationships: []
        }));
        const elementByText = new Map(elements.map(element => [element.text, element]));
        const distractors = reference.distractors.map((text, index) => ({
            index,
            label: `D${index + 1}`,
            text,
            retainedStudents: 0,
            retentionRate: NaN,
            commonPlacement: "",
            placements: [],
            possibleSubstitutions: []
        }));
        const distractorByText = new Map(distractors.map(distractor => [distractor.text, distractor]));
        const relationships = [];

        for (let firstIndex = 0; firstIndex < referenceMiddle.length - 1; firstIndex++) {
            for (let secondIndex = firstIndex + 1; secondIndex < referenceMiddle.length; secondIndex++) {
                const first = elements[firstIndex];
                const second = elements[secondIndex];

                relationships.push({
                    firstIndex,
                    secondIndex,
                    firstLabel: first.label,
                    firstText: first.text,
                    secondLabel: second.label,
                    secondText: second.text,
                    isImmediate: secondIndex === firstIndex + 1,
                    eligibleStudents: 0,
                    reversedStudents: 0,
                    reversalRate: NaN,
                    immediateCorrectStudents: 0,
                    immediateCorrectRate: NaN
                });
            }
        }

        const placementMaps = new Map(distractors.map(distractor => [distractor.text, new Map()]));
        const substitutionMap = new Map();
        const omittedMap = new Map(elements.map(element => [
            element.text,
            {
                label: element.label,
                text: element.text,
                count: 0
            }
        ]));
        const unknownExtraMap = new Map();
        const duplicateMap = new Map();
        const scores = [];

        sequences.forEach(sequence => {
            const sequenceMiddle = stripFixedElements(sequence, reference.startingElements, reference.endingElements);
            const counts = countValues(sequenceMiddle);
            const positions = new Map();

            sequenceMiddle.forEach((item, index) => {
                if (!positions.has(item)) {
                    positions.set(item, index);
                }
            });

            const affectedElements = new Set();
            const tooEarlyElements = new Set();
            const tooLateElements = new Set();
            const uniqueExpectedItems = elements.map(element => counts.get(element.text) === 1);
            const hasEligiblePredecessor = [];
            const hasEligibleSuccessor = [];
            let eligibleSeen = false;

            uniqueExpectedItems.forEach((isEligible, index) => {
                hasEligiblePredecessor[index] = eligibleSeen;
                eligibleSeen = eligibleSeen || isEligible;
            });

            eligibleSeen = false;
            for (let index = uniqueExpectedItems.length - 1; index >= 0; index--) {
                hasEligibleSuccessor[index] = eligibleSeen;
                eligibleSeen = eligibleSeen || uniqueExpectedItems[index];
            }

            elements.forEach(element => {
                const count = counts.get(element.text) || 0;

                if (count === 0) {
                    element.missingStudents++;
                    omittedMap.get(element.text).count++;
                } else if (count === 1) {
                    element.eligibleStudents++;
                } else {
                    element.duplicateStudents++;
                }

                if (count === 1) {
                    if (hasEligiblePredecessor[element.index]) {
                        element.tooEarlyEligibleStudents++;
                    }

                    if (hasEligibleSuccessor[element.index]) {
                        element.tooLateEligibleStudents++;
                    }
                }
            });

            relationships.forEach(relationship => {
                if (counts.get(relationship.firstText) !== 1 || counts.get(relationship.secondText) !== 1) {
                    return;
                }

                relationship.eligibleStudents++;
                const firstElement = elements[relationship.firstIndex];
                const secondElement = elements[relationship.secondIndex];
                firstElement.eligibleRelationships++;
                secondElement.eligibleRelationships++;

                if (positions.get(relationship.firstText) > positions.get(relationship.secondText)) {
                    relationship.reversedStudents++;
                    firstElement.relationshipErrors++;
                    secondElement.relationshipErrors++;
                    affectedElements.add(relationship.firstText);
                    affectedElements.add(relationship.secondText);
                    tooLateElements.add(relationship.firstText);
                    tooEarlyElements.add(relationship.secondText);
                    return;
                }

                if (
                    relationship.isImmediate
                    && positions.get(relationship.firstText) + 1 === positions.get(relationship.secondText)
                ) {
                    relationship.immediateCorrectStudents++;
                }
            });

            affectedElements.forEach(item => elementByText.get(item).affectedStudents++);
            tooEarlyElements.forEach(item => elementByText.get(item).tooEarlyStudents++);
            tooLateElements.forEach(item => elementByText.get(item).tooLateStudents++);

            distractors.forEach(distractor => {
                if (!counts.has(distractor.text)) {
                    return;
                }

                distractor.retainedStudents++;
                const placementMap = placementMaps.get(distractor.text);
                const distractorPosition = positions.get(distractor.text);
                let beforeElement = null;
                let afterElement = null;

                for (let index = distractorPosition - 1; index >= 0; index--) {
                    if (expectedItems.has(sequenceMiddle[index])) {
                        beforeElement = elementByText.get(sequenceMiddle[index]);
                        break;
                    }
                }

                for (let index = distractorPosition + 1; index < sequenceMiddle.length; index++) {
                    if (expectedItems.has(sequenceMiddle[index])) {
                        afterElement = elementByText.get(sequenceMiddle[index]);
                        break;
                    }
                }

                const placement = beforeElement && afterElement
                    ? {
                        key: `between:${beforeElement.label}:${afterElement.label}`,
                        description: `Between ${beforeElement.label} and ${afterElement.label}`,
                        beforeLabel: beforeElement.label,
                        beforeText: beforeElement.text,
                        afterLabel: afterElement.label,
                        afterText: afterElement.text
                    }
                    : beforeElement
                        ? {
                            key: `after:${beforeElement.label}`,
                            description: `After ${beforeElement.label}`,
                            beforeLabel: beforeElement.label,
                            beforeText: beforeElement.text,
                            afterLabel: "",
                            afterText: ""
                        }
                        : afterElement
                            ? {
                                key: `before:${afterElement.label}`,
                                description: `Before ${afterElement.label}`,
                                beforeLabel: "",
                                beforeText: "",
                                afterLabel: afterElement.label,
                                afterText: afterElement.text
                            }
                            : {
                                key: "no-neighbor",
                                description: "No neighboring sequence element",
                                beforeLabel: "",
                                beforeText: "",
                                afterLabel: "",
                                afterText: ""
                            };
                const placementRecord = createAggregateRecord(placementMap, placement.key, placement);
                placementRecord.count++;

                elements.forEach(element => {
                    if ((counts.get(element.text) || 0) !== 0) {
                        return;
                    }

                    const substitutionKey = pairKey(distractor.text, element.text);
                    const substitutionRecord = createAggregateRecord(substitutionMap, substitutionKey, {
                        distractorLabel: distractor.label,
                        distractorText: distractor.text,
                        omittedElementLabel: element.label,
                        omittedElementText: element.text
                    });
                    substitutionRecord.count++;
                });
            });

            [...counts.entries()].forEach(([item, count]) => {
                if (!expectedItems.has(item) && !distractorItems.has(item)) {
                    const extraRecord = createAggregateRecord(unknownExtraMap, item, { text: item });
                    extraRecord.count++;
                }

                if (count > 1) {
                    const knownElement = elementByText.get(item);
                    const knownDistractor = distractorByText.get(item);
                    const duplicateRecord = createAggregateRecord(duplicateMap, item, {
                        label: knownElement?.label || knownDistractor?.label || "",
                        text: item,
                        kind: knownElement ? "Sequence element" : knownDistractor ? "Distractor" : "Unknown extra"
                    });
                    duplicateRecord.count++;
                }
            });

            scores.push(analyzeSequence(reference, sequence));
        });

        relationships.forEach(relationship => {
            relationship.reversalRate = calculateRate(relationship.reversedStudents, relationship.eligibleStudents);
            relationship.immediateCorrectRate = relationship.isImmediate
                ? calculateRate(relationship.immediateCorrectStudents, relationship.eligibleStudents)
                : NaN;

            if (relationship.reversedStudents > 0) {
                const detail = {
                    firstLabel: relationship.firstLabel,
                    firstText: relationship.firstText,
                    secondLabel: relationship.secondLabel,
                    secondText: relationship.secondText,
                    eligibleStudents: relationship.eligibleStudents,
                    reversedStudents: relationship.reversedStudents,
                    reversalRate: relationship.reversalRate
                };
                elements[relationship.firstIndex].relationshipErrorsDetail.push(detail);
                elements[relationship.secondIndex].relationshipErrorsDetail.push(detail);
            }

            if (relationship.isImmediate) {
                const detail = {
                    firstLabel: relationship.firstLabel,
                    firstText: relationship.firstText,
                    secondLabel: relationship.secondLabel,
                    secondText: relationship.secondText,
                    eligibleStudents: relationship.eligibleStudents,
                    correctStudents: relationship.immediateCorrectStudents,
                    correctRate: relationship.immediateCorrectRate
                };
                elements[relationship.firstIndex].immediateRelationships.push(detail);
                elements[relationship.secondIndex].immediateRelationships.push(detail);
            }
        });

        elements.forEach(element => {
            element.affectedRate = calculateRate(element.affectedStudents, element.eligibleStudents);
            element.relationshipErrorRate = calculateRate(element.relationshipErrors, element.eligibleRelationships);
            element.tooEarlyRate = calculateRate(element.tooEarlyStudents, element.tooEarlyEligibleStudents);
            element.tooLateRate = calculateRate(element.tooLateStudents, element.tooLateEligibleStudents);
            element.missingRate = calculateRate(element.missingStudents, submissionCount);
            element.duplicateRate = calculateRate(element.duplicateStudents, submissionCount);
            element.relationshipErrorsDetail.sort((first, second) => second.reversalRate - first.reversalRate);
        });

        distractors.forEach(distractor => {
            distractor.retentionRate = calculateRate(distractor.retainedStudents, submissionCount);
            distractor.placements = [...placementMaps.get(distractor.text).values()]
                .map(placement => ({
                    ...placement,
                    rateAmongRetained: calculateRate(placement.count, distractor.retainedStudents)
                }))
                .sort((first, second) => second.count - first.count);
            distractor.commonPlacement = distractor.placements[0]?.description || "";
            distractor.possibleSubstitutions = [...substitutionMap.values()]
                .filter(substitution => substitution.distractorText === distractor.text)
                .map(substitution => ({
                    ...substitution,
                    rate: calculateRate(substitution.count, submissionCount)
                }))
                .sort((first, second) => second.count - first.count);
        });

        const omittedElements = [...omittedMap.values()]
            .filter(item => item.count > 0)
            .map(item => ({
                ...item,
                rate: calculateRate(item.count, submissionCount)
            }))
            .sort((first, second) => second.count - first.count);
        const unknownExtras = [...unknownExtraMap.values()]
            .map(item => ({
                ...item,
                rate: calculateRate(item.count, submissionCount)
            }))
            .sort((first, second) => second.count - first.count);
        const duplicates = [...duplicateMap.values()]
            .map(item => ({
                ...item,
                rate: calculateRate(item.count, submissionCount)
            }))
            .sort((first, second) => second.count - first.count);
        const segmentAnalysis = analyzeSequenceSegments(elements, relationships, sequences, reference);

        return {
            submissionCount,
            elementCount: elements.length,
            distractorCount: distractors.length,
            startingElements: [...reference.startingElements],
            endingElements: [...reference.endingElements],
            elements,
            relationships,
            distractors,
            omittedElements,
            unknownExtras,
            duplicates,
            ...segmentAnalysis,
            scoreSummary: {
                adjacentMean: calculateMean(scores.map(score => score.adjacentPairScore)),
                adjacentMedian: calculateMedian(scores.map(score => score.adjacentPairScore)),
                precedenceMean: calculateMean(scores.map(score => score.precedenceScore)),
                precedenceMedian: calculateMedian(scores.map(score => score.precedenceScore)),
                submissionsWithMissingItems: scores.filter(score => score.itemComparison.missingCount > 0).length,
                submissionsWithExtraItems: scores.filter(score => score.itemComparison.extraCount > 0).length,
                submissionsWithDuplicateItems: scores.filter(score => score.itemComparison.duplicateCount > 0).length
            }
        };
    }

    function formatNumber(value, digits = 2) {
        return Number.isFinite(value) ? value.toFixed(digits) : "N/A";
    }

    return {
        analyzeClass,
        analyzeSequence,
        calculateAdjacentPairScore,
        calculatePrecedencePairScore,
        compareExpectedItems,
        findDuplicateElements,
        findDuplicates,
        formatNumber,
        normalizeAssessmentData,
        normalizeReferenceData,
        normalizeStudentSequence,
        parseJson,
        shuffleCopy,
        splitLines,
        stripFixedElements
    };
});
