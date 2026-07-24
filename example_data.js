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

    const syntheticLmsIds = [
        "5831047", "7264915", "3148572", "8652039", "4927168",
        "6379041", "2516837", "9483156", "7058423", "3691274",
        "8145962", "5274308", "1937685", "6824519", "4562093",
        "9715346", "2386491", "7431850", "6059274", "3874162"
    ];
    const students = responses.map((response, index) => {
        const studentNumber = String(index + 1).padStart(2, "0");
        const name = `Synthetic Student ${studentNumber}`;
        const lmsId = syntheticLmsIds[index];

        return {
            name,
            lmsId,
            filename: `Synthetic_Student_${studentNumber}_${lmsId}.seq`,
            response
        };
    });
    root.SequencerExample = Object.freeze({
        title: "Insulin response to increased blood glucose",
        prompt: "Arrange the events involved in the response to increased blood glucose. One event does not belong in the sequence.",
        referenceFilename: "insulin_response_reference.seq",
        assessmentFilename: "insulin_response_assessment.seq",
        reference,
        assessment,
        responses,
        students,
        distractor,
        requiredEvents: [...requiredEvents]
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
