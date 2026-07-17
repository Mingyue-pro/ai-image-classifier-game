# MVP Scope

## Proposed Title

Using Seamful Game Design to Help Non-Experts Understand Image Classifier Behaviour in Response to Image Modifications

## Project Aim

This project aims to design and evaluate an educational game that helps non-expert young adults understand that image modifications may cause an image classifier to misclassify an image under some conditions, but not under others.

The classifier's sensitivity to input changes is conditional.

Through predicting, manipulating image variables, reclassifying, comparing results, and using evidence to explain the results, users explore why some image modifications may cause misclassification while other similar modifications do not.

The project also investigates whether users can apply this understanding when explaining unseen cases, while avoiding attributing every classification error to image modifications.

## Research Questions

### RQ1

How does the predict–manipulate–reclassify–compare–explain interaction process support non-expert young adults in understanding when image modifications cause misclassification?

### RQ2

After using the game, how do non-expert young adults use comparison evidence to form or revise explanations of previously unseen image classification cases, while avoiding attributing every classification error to image modifications?

## Image Modification Types

1. Adversarial patches, which are visually noticeable modifications.
2. Pixel-level perturbations, which are difficult to notice under normal viewing conditions.

In both types of cases, the modified image should remain recognisable to humans.

## Required Outcome Types

The complete case set will include:

1. Modifications that affect the prediction.
2. Modifications that do not affect the prediction.
3. Cases in which reducing or removing a modification restores the correct prediction.
4. Cases in which reducing or removing a modification leaves the prediction incorrect.

## Learning Outcomes

1. Users should be able to explain that image classifiers may respond differently to different image modifications, and that an image modification does not necessarily change the prediction.
2. Users should be able to explain that reducing or removing an image modification does not necessarily restore the correct prediction.
3. Users should be able to make a specific prediction, select a relevant manipulation, compare the before-and-after results, and use the evidence to support or revise their explanation.
4. Users should be able to apply this conditional understanding to unseen cases while retaining uncertainty and considering other possible causes.

## Core Learning Process

Predict → Manipulate → Reclassify → Compare → Explain

## Must-have Requirements

1. Display an image together with the classifier's initial prediction.
2. Include at least one adversarial patch case and one difficult-to-notice pixel-level perturbation case.
3. Require users to record a prediction and initial hypothesis before manipulating the image.
4. Allow users to manipulate a controlled image variable, such as patch position, patch size, local region, or perturbation strength.
5. Reclassify the manipulated image using a real image classifier.
6. Allow users to compare the image and classifier prediction before and after manipulation.
7. Include prediction-changing and prediction-preserving outcomes.
8. Include cases in which reducing or removing a modification restores or does not restore the correct prediction.
9. Require users to provide a final explanation and indicate whether the evidence supported, weakened, or revised their initial hypothesis.
10. Provide an understanding check and feedback after each educational case.
11. Include at least one previously unseen case in which users explain classifier behaviour using comparison evidence.

## Target Users

Non-expert young adults.

## Current Status

The research scope is confirmed. Detailed interaction design and game features will be refined after the core MVP is operational.