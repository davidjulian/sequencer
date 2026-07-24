const assert = require('node:assert/strict');
const SequencerCore = require('../sequencer_core.js');

function nearly(actual, expected, message) {
    assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: expected ${expected}, received ${actual}`);
}

function score(reference, response, options = {}) {
    return SequencerCore.analyzeSequence({
        startingElements: options.startingElements || [],
        sequence: reference,
        endingElements: options.endingElements || [],
        distractors: options.distractors || [],
        referenceSequences: options.referenceSequences
    }, response);
}

{
    const result = score(['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['A', 'D', 'B', 'C', 'E', 'F', 'G']);
    nearly(result.positionalScore, 4 / 7 * 100, 'positional example');
    nearly(result.adjacentPairScore, 3 / 6 * 100, 'adjacent-pair example');
    nearly(result.pairwiseRelativeOrderScore, 19 / 21 * 100, 'pairwise example');
    nearly(result.hybridLocalGlobalScore, ((3 / 6) + (19 / 21)) / 2 * 100, 'hybrid example');
}

{
    const result = score(['A', 'B', 'C'], ['A', 'X', 'B', 'C'], { distractors: ['X'] });
    nearly(result.positionalScore, 1 / 3 * 100, 'distractor shifts positional score');
    nearly(result.adjacentPairScore, 1 / 2 * 100, 'distractor interrupts adjacency');
    nearly(result.pairwiseRelativeOrderScore, 100, 'distractor does not change required-pair order');
    nearly(result.hybridLocalGlobalScore, 75, 'hybrid averages local and global scores');
    assert.equal(result.distractor_included_count, 1);
}

{
    const result = score(['A', 'B', 'C'], ['A', 'C']);
    nearly(result.positionalScore, 1 / 3 * 100, 'omission positional score');
    nearly(result.adjacentPairScore, 0, 'omission adjacent-pair score');
    nearly(result.pairwiseRelativeOrderScore, 1 / 3 * 100, 'omission pairwise denominator remains fixed');
    assert.equal(result.required_omitted_count, 1);
}

{
    const result = score(['A', 'B', 'C'], ['A', 'B', 'B', 'C']);
    nearly(result.positionalScore, 2 / 3 * 100, 'duplicate positional score');
    nearly(result.adjacentPairScore, 100, 'duplicate does not remove preserved reference adjacencies');
    nearly(result.pairwiseRelativeOrderScore, 100, 'pairwise uses first occurrence');
    assert.deepEqual(result.itemComparison.duplicateItems, ['B']);
}

{
    const result = score(['A', 'B', 'C'], ['A', 'C', 'B'], {
        referenceSequences: [{ id: 'alternate', sequence: ['A', 'C', 'B'] }]
    });
    nearly(result.positionalScore, 100, 'accepted alternate positional score');
    nearly(result.adjacentPairScore, 100, 'accepted alternate adjacent-pair score');
    nearly(result.pairwiseRelativeOrderScore, 100, 'accepted alternate pairwise score');
    nearly(result.hybridLocalGlobalScore, 100, 'accepted alternate hybrid score');
}

{
    const result = SequencerCore.analyzeSequence({
        startingElements: ['Start'],
        sequence: ['Start', 'A', 'B', 'End'],
        endingElements: ['End'],
        distractors: []
    }, ['Start', 'A', 'B', 'End']);
    nearly(result.hybridLocalGlobalScore, 100, 'fixed anchors are excluded from scoring');
}

{
    const report = SequencerCore.analyzeClass({
        startingElements: [], sequence: ['A', 'B', 'C'], endingElements: [], distractors: ['X']
    }, [['A', 'B', 'C'], ['A', 'X', 'B', 'C']]);
    nearly(report.scoreSummary.adjacentMean, 75, 'class adjacent-pair mean');
    nearly(report.scoreSummary.pairwiseMean, 100, 'class pairwise mean');
    nearly(report.scoreSummary.hybridMean, 87.5, 'class hybrid mean');
    assert.equal(report.distractors[0].retainedStudents, 1);
}

{
    const result = score(['A', 'B', 'C', 'D'], ['A', 'C', 'B', 'D'], {
        referenceSequences: [{ id: 'alternate', sequence: ['A', 'B', 'D', 'C'] }]
    });
    assert.equal(result.adjacent_pair_best_reference_id_labeled_full_sequence, 'alternate');
    assert.equal(result.pairwise_relative_order_best_reference_id_labeled_full_sequence, 'reference_1');
    nearly(result.hybridLocalGlobalScore, ((1 / 3) + (5 / 6)) / 2 * 100, 'hybrid averages independently retained method scores');
    assert.equal(result.hybrid_local_global_best_reference_id_labeled_full_sequence, 'alternate / reference_1');
}
console.log('sequencer_core tests passed');
