import assert from "node:assert/strict";
import test from "node:test";
import {
  assessQuestionCompleteness,
  isCompleteEnoughForPromotion
} from "./questionCompletenessGuard";
import { looksLikeQuestion } from "./questionDetector";

test("incomplete WH fragment is not complete enough for promotion", () => {
  assert.equal(
    isCompleteEnoughForPromotion("How do Microsoft Teams"),
    false
  );
  assert.equal(
    assessQuestionCompleteness("How do Microsoft Teams").reason,
    "wh_auxiliary_missing_predicate"
  );
  // Existing detector still treats it as question-shaped; the guard is
  // what blocks promotion.
  assert.equal(looksLikeQuestion("How do Microsoft Teams"), true);
});

test("complete WH questions are promoted", () => {
  assert.equal(
    isCompleteEnoughForPromotion(
      "How do Microsoft Teams Calling Plans work?"
    ),
    true
  );
  assert.equal(
    isCompleteEnoughForPromotion(
      "Which cmdlet assigns a voice routing policy?"
    ),
    true
  );
  assert.equal(
    isCompleteEnoughForPromotion("What about external access?"),
    true
  );
});

test("short terminal questions remain complete enough", () => {
  for (const question of [
    "Calling Plans?",
    "External access?",
    "Which cmdlet?",
    "Why?"
  ]) {
    assert.equal(
      isCompleteEnoughForPromotion(question),
      true,
      question
    );
  }
});

test("trailing function words and truncated frames are incomplete", () => {
  assert.equal(isCompleteEnoughForPromotion("How do"), false);
  assert.equal(isCompleteEnoughForPromotion("What is"), false);
  assert.equal(isCompleteEnoughForPromotion("What about"), false);
  assert.equal(
    isCompleteEnoughForPromotion("Which policy controls"),
    false
  );
  assert.equal(
    assessQuestionCompleteness("Which policy controls").reason,
    "trailing_transitive_without_object"
  );
});

test("complete questions without a question mark can still pass", () => {
  assert.equal(
    isCompleteEnoughForPromotion(
      "How does Microsoft Teams Phone work"
    ),
    true
  );
  assert.equal(
    isCompleteEnoughForPromotion("What is a Calling Plan"),
    true
  );
  assert.equal(
    isCompleteEnoughForPromotion(
      "Which policy controls Teams meetings"
    ),
    true
  );
});

test("declarative speech is not rejected by the completeness gate", () => {
  const assessment = assessQuestionCompleteness(
    "This is a statement about Calling Plans."
  );
  assert.equal(assessment.complete, true);
  assert.equal(assessment.reason, "non_interrogative_pass");
  assert.equal(
    looksLikeQuestion("This is a statement about Calling Plans."),
    false
  );
});
