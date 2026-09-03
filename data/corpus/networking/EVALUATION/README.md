# Retrieval Evaluation

Run these questions before expanding the corpus. The purpose is not merely to verify that a chunk contains the right noun; it is to verify that retrieval produces enough **causal and procedural content** to answer the user's likely question.

## Pass criteria

For each row in `retrieval_questions.jsonl`:

1. the `networking_beginner` source must survive source/domain eligibility;
2. at least one expected document should appear near the top of retrieval;
3. retrieved chunks should retain a meaningful `heading_path`;
4. the answer should cover the listed `required_concepts`;
5. troubleshooting questions must return a usable sequence or decision path, not only protocol definitions.

## Recommended smoke test

Start with the first three questions. If they fail, fix source eligibility, taxonomy mapping, chunk structure, or document content **before** adding more files.
