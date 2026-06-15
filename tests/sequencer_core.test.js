const assert = require('node:assert/strict');
const SequencerCore = require('../sequencer_core.js');

function assertNearlyEqual(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 0.000001, `${message}: expected ${expected}, received ${actual}`);
}

function assertKeys(actual, expected, message) {
    assert.deepEqual(Object.keys(actual), expected, message);
}

function encodeAssessmentSequenceForTest(sequence) {
    const content = JSON.stringify(sequence);
    const binaryString = encodeURIComponent(content).replace(/%([0-9A-F]{2})/g, (match, byte) => {
        return String.fromCharCode(parseInt(byte, 16));
    });

    return Buffer.from(binaryString, 'binary').toString('base64');
}

{
    const score = SequencerCore.calculateAdjacentPairScore(['Step 1', 'Step 2'], ['Step 2', 'Step 1']);

    assert.equal(score.points, 0);
    assertNearlyEqual(score.adjacentPairScore, 50, 'reversed multi-character pair should be neutral');
    assertKeys(score, ['points', 'maxPoints', 'adjacentPairScore'], 'adjacent pair score should expose only current score fields');
}

{
    const score = SequencerCore.calculateAdjacentPairScore(['AB', 'C'], ['A', 'BC']);

    assert.equal(score.points, -1);
    assertNearlyEqual(score.adjacentPairScore, 0, 'different pairs should not collide after string concatenation');
    assertKeys(score, ['points', 'maxPoints', 'adjacentPairScore'], 'adjacent pair score should expose only current score fields');
}

{
    const score = SequencerCore.calculatePrecedencePairScore(['A', 'B', 'C', 'D', 'E'], ['A', 'C', 'B', 'D', 'E']);

    assert.equal(score.correctPairs, 9);
    assert.equal(score.totalPairs, 10);
    assertNearlyEqual(score.score, 90, 'one adjacent swap should preserve most pairwise precedence relationships');
}

{
    const score = SequencerCore.calculatePrecedencePairScore(['A', 'B', 'C', 'D', 'E'], ['E', 'D', 'C', 'B', 'A']);

    assert.equal(score.correctPairs, 0);
    assert.equal(score.totalPairs, 10);
    assertNearlyEqual(score.score, 0, 'fully reversed sequence should have no correct pairwise precedence');
}

{
    const result = SequencerCore.analyzeSequence(
        {
            startingElements: ['Start'],
            sequence: ['Start', 'A', 'B', 'End'],
            endingElements: ['End'],
            distractors: []
        },
        ['Start', 'B', 'A', 'End']
    );

    assert.equal(result.points, 0);
    assertNearlyEqual(result.adjacentPairScore, 50, 'fixed start/end elements should be ignored for adjacent pair scoring');
    assertKeys(result, [
        'points',
        'maxPoints',
        'adjacentPairScore',
        'precedencePairsCorrect',
        'precedencePairsTotal',
        'precedenceScore',
        'weightedOrderScore',
        'itemComparison'
    ], 'sequence analysis should expose only current score fields');
}

{
    const result = SequencerCore.analyzeSequence(
        {
            startingElements: [],
            sequence: ['Only item'],
            endingElements: [],
            distractors: []
        },
        ['Only item']
    );

    assert.equal(result.points, 0);
    assertNearlyEqual(result.adjacentPairScore, 100, 'single-item exact match should score as correct');
    assertKeys(result, [
        'points',
        'maxPoints',
        'adjacentPairScore',
        'precedencePairsCorrect',
        'precedencePairsTotal',
        'precedenceScore',
        'weightedOrderScore',
        'itemComparison'
    ], 'sequence analysis should expose only current score fields');
}

{
    const comparison = SequencerCore.compareExpectedItems(['A', 'B', 'C', 'D'], ['A', 'B', 'X', 'B']);

    assert.deepEqual(comparison.missingItems, ['C', 'D']);
    assert.deepEqual(comparison.extraItems, ['X']);
    assert.deepEqual(comparison.duplicateItems, ['B']);
    assert.equal(comparison.hasFlags, true);
}

{
    const result = SequencerCore.analyzeSequence(
        {
            startingElements: [],
            sequence: ['A', 'B', 'C', 'D', 'E'],
            endingElements: [],
            distractors: []
        },
        ['A', 'B', 'X', 'C', 'D', 'E']
    );

    assert.deepEqual(result.itemComparison.extraItems, ['X']);
    assertNearlyEqual(result.precedenceScore, 100, 'extra distractors should be flagged but not disrupt expected-item precedence');
    assertNearlyEqual(result.weightedOrderScore, 81.25, 'weighted score should average adjacent and precedence scores');
    assertKeys(result, [
        'points',
        'maxPoints',
        'adjacentPairScore',
        'precedencePairsCorrect',
        'precedencePairsTotal',
        'precedenceScore',
        'weightedOrderScore',
        'itemComparison'
    ], 'sequence analysis should expose only current score fields');
}

{
    const assessment = SequencerCore.normalizeAssessmentData({
        startingElements: ['intro'],
        sequence: ['alpha', 'beta', 'gamma'],
        endingElements: ['outro'],
        numberOfDistractors: 1
    });

    assert.deepEqual(assessment.sequence, ['alpha', 'beta', 'gamma']);
    assert.deepEqual(assessment.startingElements, ['intro']);
    assert.deepEqual(assessment.endingElements, ['outro']);
    assert.equal(assessment.numberOfDistractors, 1);
}

{
    const encoded = encodeAssessmentSequenceForTest(['encoded alpha', 'encoded beta']);
    const assessment = SequencerCore.normalizeAssessmentData({
        startingElements: [],
        sequence: encoded,
        endingElements: [],
        numberOfDistractors: 0
    });

    assert.deepEqual(assessment.sequence, ['encoded alpha', 'encoded beta']);
}

{
    const report = SequencerCore.analyzeClass(
        {
            startingElements: [],
            sequence: ['A', 'B', 'C', 'D'],
            endingElements: [],
            distractors: ['X']
        },
        [
            ['A', 'B', 'C', 'D'],
            ['A', 'C', 'B', 'D'],
            ['A', 'C', 'D', 'B'],
            ['A', 'X', 'B', 'D']
        ]
    );

    const elementB = report.elements.find(element => element.text === 'B');
    const elementC = report.elements.find(element => element.text === 'C');
    const relationshipBC = report.relationships.find(relationship => (
        relationship.firstText === 'B' && relationship.secondText === 'C'
    ));
    const distractorX = report.distractors.find(distractor => distractor.text === 'X');

    assert.equal(report.submissionCount, 4);
    assert.equal(elementB.label, 'E2');
    assert.equal(elementB.affectedStudents, 2);
    assert.equal(elementB.relationshipErrors, 3);
    assert.equal(elementB.eligibleRelationships, 11);
    assertNearlyEqual(elementB.relationshipErrorRate, 3 / 11 * 100, 'event relationship error rate should use eligible relationships');
    assert.equal(elementB.tooLateStudents, 2);
    assert.equal(elementC.missingStudents, 1);
    assert.equal(elementC.tooEarlyStudents, 2);
    assert.equal(relationshipBC.eligibleStudents, 3);
    assert.equal(relationshipBC.reversedStudents, 2);
    assert.equal(relationshipBC.immediateCorrectStudents, 1);
    assertNearlyEqual(relationshipBC.reversalRate, 2 / 3 * 100, 'relationship reversal rate should exclude missing elements');
    assert.equal(distractorX.retainedStudents, 1);
    assert.equal(distractorX.commonPlacement, 'Between E1 and E2');
    assert.equal(distractorX.possibleSubstitutions[0].omittedElementLabel, 'E3');
    assert.equal(report.omittedElements[0].label, 'E3');
}

{
    const report = SequencerCore.analyzeClass(
        {
            startingElements: [],
            sequence: ['A', 'B', 'C'],
            endingElements: [],
            distractors: []
        },
        [
            ['A', 'B', 'C', 'Unknown'],
            ['A', 'B', 'B', 'C']
        ]
    );

    assert.equal(report.unknownExtras[0].text, 'Unknown');
    assert.equal(report.unknownExtras[0].count, 1);
    assert.equal(report.duplicates[0].label, 'E2');
    assert.equal(report.duplicates[0].count, 1);
    assert.equal(report.relationships.find(relationship => relationship.firstText === 'A' && relationship.secondText === 'B').eligibleStudents, 1);
}

{
    const report = SequencerCore.analyzeClass(
        {
            startingElements: ['Fixed start'],
            sequence: ['A', 'B', 'C', 'D', 'E', 'F'],
            endingElements: ['Fixed end'],
            distractors: []
        },
        [
            ['A', 'B', 'C', 'D', 'E', 'F'],
            ['A', 'B', 'C', 'D', 'E', 'F'],
            ['A', 'B', 'C', 'D', 'E', 'F'],
            ['A', 'C', 'B', 'D', 'E', 'F'],
            ['A', 'C', 'B', 'D', 'E', 'F'],
            ['A', 'C', 'B', 'D', 'E', 'F'],
            ['A', 'D', 'C', 'B', 'E', 'F'],
            ['A', 'D', 'C', 'B', 'E', 'F'],
            ['A', 'B', 'D', 'C', 'E', 'F'],
            ['A', 'B', 'C', 'D', 'F', 'E']
        ]
    );

    assert.deepEqual(report.startingElements, ['Fixed start']);
    assert.deepEqual(report.endingElements, ['Fixed end']);
    assert.equal(report.sequenceSegments.length, 1);
    assert.equal(report.sequenceSegments[0].startLabel, 'E2');
    assert.equal(report.sequenceSegments[0].endLabel, 'E4');
    assert.equal(report.sequenceSegments[0].affectedStudents, 6);
    assertNearlyEqual(report.sequenceSegments[0].affectedRate, 60, 'segment affected rate should count incorrect projected orders');
    assert.equal(report.sequenceSegments[0].commonIncorrectOrders[0].description, 'E2 and E3 swapped');
    assert.deepEqual(report.sequenceSegments[0].commonIncorrectOrders[0].labels, ['E3', 'E2', 'E4']);
    assert.equal(report.sequenceSegments[0].frequentRelationships.length, 3);
    assert.equal(report.isolatedRelationshipErrors.length, 0, 'relationships below the reporting threshold should not be reported');
    assert.equal(report.broadSequenceConfusion.length, 0);
}

{
    const report = SequencerCore.analyzeClass(
        {
            startingElements: [],
            sequence: ['A', 'B', 'C', 'D'],
            endingElements: [],
            distractors: []
        },
        [
            ['A', 'B', 'C', 'D'],
            ['A', 'B', 'C', 'D'],
            ['A', 'B', 'C', 'D'],
            ['A', 'B', 'D', 'C']
        ]
    );

    assert.equal(report.sequenceSegments.length, 0);
    assert.equal(report.isolatedRelationshipErrors.length, 1);
    assert.equal(report.isolatedRelationshipErrors[0].firstLabel, 'E3');
    assert.equal(report.isolatedRelationshipErrors[0].secondLabel, 'E4');
}

{
    const sequence = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const report = SequencerCore.analyzeClass(
        {
            startingElements: [],
            sequence,
            endingElements: [],
            distractors: []
        },
        [
            sequence,
            sequence,
            [...sequence].reverse(),
            [...sequence].reverse()
        ]
    );

    assert.equal(report.sequenceSegments.length, 0);
    assert.equal(report.broadSequenceConfusion.length, 1);
    assert.equal(report.broadSequenceConfusion[0].startLabel, 'E1');
    assert.equal(report.broadSequenceConfusion[0].endLabel, 'E8');
    assert.deepEqual(report.broadSequenceConfusion[0].commonIncorrectOrders, []);
}

{
    const elementCount = 200;
    const submissionCount = 100;
    const sequence = Array.from({ length: elementCount }, (_, index) => `Element ${index + 1}`);
    const students = Array.from({ length: submissionCount }, (_, index) => (
        index % 2 === 0 ? [...sequence] : [...sequence].reverse()
    ));
    const start = performance.now();
    const report = SequencerCore.analyzeClass(
        {
            startingElements: [],
            sequence,
            endingElements: [],
            distractors: []
        },
        students
    );
    const elapsed = performance.now() - start;

    assert.equal(report.relationships.length, elementCount * (elementCount - 1) / 2);
    assert.ok(elapsed < 5000, `large class analysis should finish within 5 seconds; received ${elapsed.toFixed(0)} ms`);
}

console.log('sequencer_core tests passed');
