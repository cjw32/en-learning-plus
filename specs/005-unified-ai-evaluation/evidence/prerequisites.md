# External execution prerequisites — T004

Date: 2026-09-14. This register grants no approval. CLOSED means dependent real execution is unavailable; independent offline work may proceed.

| Gate | Source | Owner role | State | Required evidence/recovery |
|---|---|---|---|---|
| G-01 | DEP-001/002/006 | data owner + human reviewers + maintainer | CLOSED | Authorized audio/holdout, human gold and calibration; subsequent approved policy/minN/baseline. Preparation does not require its own future output. |
| G-02 | DEP-004 | budget owner | CLOSED | Explicit paid-run authorization and price/model/currency/whole-run upper bounds including baseline, embedding, judge and clients. |
| G-03 | DEP-004/007 | environment owner | CLOSED | Dedicated least-privilege resource identities, native tools, test leases and verifiable cleanup. No production or automatic installation. |
| G-04 | DEP-003 | client operator | CLOSED | Real Codex/Claude Desktop/VS Code/Inspector sessions, independent challenge/Trace, capabilities and bounded usage. |
| G-05 | DEP-005/006 | repository/data maintainer | CLOSED | Authorized Agent/CI environment, artifact ACL/TTL/revocation/deletion and separately approved remote configuration. |

Validation: all DEP-001–007 linked, owners/states/recovery explicit; no values or approvals fabricated. PASS for register completeness, not for any gate.
