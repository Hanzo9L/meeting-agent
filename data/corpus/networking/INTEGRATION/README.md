# Integration Requirements

This corpus is ready at the **document layer**, but adding files to disk alone is not sufficient when the store gates retrieval by `sourceId` and selected taxonomy domains.

## Stable source ID

All ingestible corpus documents use:

```text
sourceId: networking_beginner
```

Keep that value stable once indexed. Renaming it later can strand old chunks or create duplicate logical sources.

## Required application-side work

Before bulk ingestion:

1. Add a source definition for `networking_beginner` using the project's real source registry/type.
2. Map that source to the existing networking domain in `taxonomy.ts` and, if appropriate, the existing UC/voice domain. **Do not invent new taxonomy constants if equivalent project domains already exist.**
3. Add a corpus job that ingests the three topic roots listed in `source-definition.json`.
4. Ensure the job keeps Markdown structure intact so headings reach the current structural chunker and `heading_path` is populated.
5. Run an eligibility test proving a networking-domain query does not exclude this source as `not_applicable_to_selected_domains`.
6. Run the retrieval evaluation set in `../EVALUATION/` before adding substantially more documents.

## Ingest only canonical topic files

The combined study guide is convenient for a human, but should **not** be ingested alongside the topic files because it duplicates the same concepts and can distort retrieval ranking.

The canonical ingest roots are:

```text
Networking_Fundamentals/
UC_Networking_Bridge/
Troubleshooting_Playbooks/
```

## License

The primary upstream source is *Computer Networks: A Systems Approach (7th Edition)* by Larry L. Peterson and Bruce S. Davie, made available under CC BY 4.0. This corpus is a rewritten/reorganized adaptation and retains CC BY 4.0 plus attribution/change notices in `../ATTRIBUTION.md`.

## Why the playbooks exist

Specifications are good at defining protocols. They are often poor at answering operational questions such as "where do I start?" The playbooks deliberately add procedural troubleshooting and causal explanations for the questions most likely to be asked of the corpus.
