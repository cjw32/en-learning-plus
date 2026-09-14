# Execution evidence conventions — T003

Every completed task records: task and FR/SC IDs, actual command (repository root unless stated), exit code, checks and sample counts, configuration/mode, code/input/report hashes where available, environment, authorization, failures, skips and limits. No fabricated results or credentials.

- RED: targeted missing behavior assertion failed; record exact test names. Import errors, syntax or broken test configuration are not valid RED evidence.
- GREEN: targeted tests pass; record counts and prior RED reference. Shared suites may select the relevant behavior until their remaining prerequisite implementations exist; phase completion reruns the full suite.
- Actual AI evaluation: real run/case/attempt/Trace and report integrity, model/prompt versions, dataset/gold/provenance, budget and costs. Mock tests never count as real quality or actual resource isolation.
- NOT RUN/BLOCKED: reason, missing prerequisite and recovery action; leave task unchecked.

Repository evidence contains safe synthetic summaries only. Restricted inputs/transcripts/audio go only into already authorized private artifact stores; no such collection is authorized in this task. Failures remain in evidence when later checks pass.

Validation: reviewed these distinct evidence states against tasks T003 and FR-035/037/039; no invented PASS/approval or sensitive example. Documentation check PASS.
