# Converting the Corpus to DOCX

Markdown is the preferred source format for this corpus. If you want Word documents, Pandoc can convert either one file or the combined guide.

## Convert one file

```bash
pandoc Networking_Fundamentals/06_DHCP.md -o DHCP.docx
```

## Convert the combined guide

```bash
pandoc Combined_Networking_Study_Guide.md -o Networking_Study_Guide.docx --toc
```

## Combine all Markdown yourself and convert

macOS/Linux example:

```bash
cat Networking_Fundamentals/*.md UC_Networking_Bridge/*.md > all_networking.md
pandoc all_networking.md -o all_networking.docx --toc
```

PowerShell example:

```powershell
Get-Content Networking_Fundamentals\*.md, UC_Networking_Bridge\*.md | Set-Content all_networking.md
pandoc all_networking.md -o all_networking.docx --toc
```

For RAG or AI ingestion, keep the individual Markdown files. For human printing or review, use the combined file or DOCX conversion.
