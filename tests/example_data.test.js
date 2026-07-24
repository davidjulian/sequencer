const assert = require('node:assert/strict');
const SequencerCore = require('../sequencer_core.js');
require('../example_data.js');

const example = globalThis.SequencerExample;
assert.ok(example, 'example data should be available');
assert.equal(example.reference.startingElements.length, 1);
assert.equal(example.reference.endingElements.length, 1);
assert.equal(example.reference.distractors.length, 1);
assert.equal(example.requiredEvents.length, 5);
assert.equal(example.responses.length, 20);
assert.ok(example.responses.every(response => response.length === 5));
assert.equal(example.responses.filter(response => response.includes(example.distractor)).length, 2);

const report = SequencerCore.analyzeClass(example.reference, example.responses);
assert.equal(report.submissionCount, 20);
assert.equal(report.elementCount, 5);
assert.equal(report.distractorCount, 1);
assert.equal(report.distractors[0].retainedStudents, 2);
assert.equal(report.omittedElements.reduce((total, item) => total + item.count, 0), 2);

console.log('example data tests passed');
