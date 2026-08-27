import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyQuestionIntent,
  isPersonalResponseMode
} from "./questionIntent";
import { lookupApprovedPersonalStory } from "./approvedPersonalStories";

test("strong personal questions are not technical evidence", () => {
  const cases = [
    "Tell me about the hardest UC problem you solved.",
    "Tell me about a script you wrote from scratch.",
    "What is the most complex task you automated?",
    "Tell me about a time you diagnosed a difficult issue.",
    "Describe a situation where you had to recover a failed cutover.",
    "Give me an example from your experience supporting a major incident.",
    "Have you coordinated number porting with carriers? What is the biggest challenge you have faced?",
    "What is your comfort level with Linux command line? Give me an example of using it to manage a service or script."
  ];
  for (const question of cases) {
    const decision = classifyQuestionIntent(question);
    assert.equal(
      isPersonalResponseMode(decision.responseMode),
      true,
      question
    );
    assert.equal(decision.intentClass, "behavioral_story", question);
  }
});

test("script-from-scratch without a named stack stays personal-only", () => {
  const decision = classifyQuestionIntent(
    "Tell me about a script you wrote from scratch."
  );
  assert.equal(decision.responseMode, "personal_response");
});

test("personal questions with technical backup are mixed", () => {
  const mixed = [
    "Tell me about a PowerShell script you wrote to fix a systemic UC issue.",
    "What is the most complex administrative task you automated from scratch? Walk me through identifying the opportunity and building the PowerShell or Python script.",
    "Tell me about a time you troubleshot a persistent call quality issue in Microsoft Teams. How did you use Call Quality Dashboard (CQD) and Call Analytics to identify the root cause?"
  ];
  for (const question of mixed) {
    const decision = classifyQuestionIntent(question);
    assert.equal(
      decision.responseMode,
      "mixed_personal_technical",
      question
    );
  }
});

test("technical explanation shapes stay on evidence cards", () => {
  const cases = [
    "Explain Direct Routing as if I were a junior engineer.",
    "How would you troubleshoot one-way audio on a Teams Direct Routing call?",
    "How would you configure an Auto Attendant and Call Queue?",
    "What is Get-CsOnlineUser?",
    "What happens if an SBC or carrier fails?",
    "Walk me through creating a Teams Room resource account.",
    "How does media bypass work with Direct Routing?",
    "What architecture approach would you take to use Direct Routing?",
    "Tell me about Direct Routing.",
    "What is your experience configuring an Auto Attendant and Call Queue from start to finish? Talk me through it."
  ];
  for (const question of cases) {
    const decision = classifyQuestionIntent(question);
    assert.equal(decision.responseMode, "technical_evidence", question);
    assert.equal(isPersonalResponseMode(decision.responseMode), false, question);
  }
});

test("ambiguous questions default to technical evidence", () => {
  const decision = classifyQuestionIntent("Teams Voice");
  assert.equal(decision.responseMode, "technical_evidence");
  assert.equal(decision.reason, "ambiguous_default_technical");
});

test("diagnose/investigate/determine classify as troubleshooting only with a failure symptom", () => {
  const troubleshooting = [
    "A user is complaining of poor audio. How would you determine where the problem is?",
    "A Teams Room account keeps locking out. How would you investigate it?",
    "How would you diagnose intermittent one-way audio?",
    "How would you isolate a dropped-call problem?",
    "How would you identify the root cause of a sign-in failure?",
    "How would you find the root cause of poor call quality?",
    "How would you figure out why users cannot connect?"
  ];
  for (const question of troubleshooting) {
    const decision = classifyQuestionIntent(question);
    assert.equal(decision.intentClass, "troubleshooting", question);
    assert.equal(decision.responseMode, "technical_evidence", question);
  }

  const notTroubleshooting = [
    "How would you investigate new SBC vendors?",
    "How would you determine the best architecture for Direct Routing?",
    "How would you use PowerShell to audit Teams Voice users?"
  ];
  for (const question of notTroubleshooting) {
    const decision = classifyQuestionIntent(question);
    assert.notEqual(decision.intentClass, "troubleshooting", question);
  }
  assert.notEqual(
    classifyQuestionIntent(
      "How would you determine the best architecture for Direct Routing?"
    ).intentClass,
    "troubleshooting"
  );
  const personal = classifyQuestionIntent(
    "Tell me about a time you investigated a difficult Teams issue."
  );
  assert.equal(personal.intentClass, "behavioral_story");
  assert.equal(isPersonalResponseMode(personal.responseMode), true);
});

test("no approved personal story store exists yet", () => {
  assert.equal(
    lookupApprovedPersonalStory(
      "Tell me about the hardest UC problem you solved."
    ),
    null
  );
});
