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
assert.equal(example.students.length, 20);
assert.ok(example.responses.every(response => response.length === 5));
assert.equal(example.responses.filter(response => response.includes(example.distractor)).length, 2);
assert.equal(new Set(example.students.map(student => student.lmsId)).size, 20);
assert.ok(example.students.every((student, index) => (
    student.name === `Synthetic Student ${String(index + 1).padStart(2, "0")}`
    && /^\d{7}$/.test(student.lmsId)
    && student.filename.includes(student.lmsId)
    && student.response === example.responses[index]
)));

const report = SequencerCore.analyzeClass(example.reference, example.responses);
assert.equal(report.submissionCount, 20);
assert.equal(report.elementCount, 5);
assert.equal(report.distractorCount, 1);
assert.equal(report.distractors[0].retainedStudents, 2);
assert.equal(report.omittedElements.reduce((total, item) => total + item.count, 0), 2);

console.log('example data tests passed');
