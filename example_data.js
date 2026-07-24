(function initializeSequencerExample(root) {
    "use strict";

    const startingAnchor = "A carbohydrate-containing meal increases blood glucose.";
    const endingAnchor = "Blood glucose returns toward its premeal level.";
    const requiredEvents = [
        "Pancreatic β-cells detect increased blood glucose.",
        "Pancreatic β-cells increase insulin release.",
        "Insulin binding to receptors on target cells increases.",
        "The number of GLUT4 transporters in the plasma membrane increases in skeletal muscle and adipose cells.",
        "Skeletal muscle and adipose cells increase glucose uptake."
    ];
    const distractor = "Pancreatic α-cells increase glucagon release.";

    const reference = {
        startingElements: [startingAnchor],
        sequence: requiredEvents,
        endingElements: [endingAnchor],
        distractors: [distractor],
        numberOfDistractors: 1
    };

    const assessment = {
        startingElements: [startingAnchor],
        sequence: [
            requiredEvents[3],
            distractor,
            requiredEvents[1],
            requiredEvents[4],
            requiredEvents[0],
            requiredEvents[2]
        ],
        endingElements: [endingAnchor],
        numberOfDistractors: 1
    };

    const responsePatterns = [
        { count: 6, sequence: [requiredEvents[0], requiredEvents[1], requiredEvents[2], requiredEvents[3], requiredEvents[4]] },
        { count: 4, sequence: [requiredEvents[1], requiredEvents[0], requiredEvents[2], requiredEvents[3], requiredEvents[4]] },
        { count: 3, sequence: [requiredEvents[0], requiredEvents[2], requiredEvents[1], requiredEvents[3], requiredEvents[4]] },
        { count: 3, sequence: [requiredEvents[0], requiredEvents[1], requiredEvents[3], requiredEvents[2], requiredEvents[4]] },
        { count: 2, sequence: [requiredEvents[0], requiredEvents[1], requiredEvents[2], requiredEvents[4], requiredEvents[3]] },
        { count: 1, sequence: [requiredEvents[0], requiredEvents[1], requiredEvents[2], distractor, requiredEvents[4]] },
        { count: 1, sequence: [requiredEvents[0], distractor, requiredEvents[2], requiredEvents[3], requiredEvents[4]] }
    ];

    const responses = [];
    responsePatterns.forEach(pattern => {
        for (let index = 0; index < pattern.count; index++) {
            responses.push([...pattern.sequence]);
        }
    });

    root.SequencerExample = Object.freeze({
        title: "Insulin response to increased blood glucose",
        prompt: "Arrange the events involved in the response to increased blood glucose. One event does not belong in the sequence.",
        referenceFilename: "insulin_response_reference.seq",
        assessmentFilename: "insulin_response_assessment.seq",
        reference,
        assessment,
        responses,
        distractor,
        requiredEvents: [...requiredEvents]
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
