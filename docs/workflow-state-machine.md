# Workflow State Machine

Stages:
1. inbox
2. classification
3. refinement
4. planning
5. development
6. code_review
7. testing
8. human_approval
9. merge
10. done

Default policies:
- inbox -> classification: automatic
- classification -> refinement: automatic
- refinement -> planning: manual
- planning -> development: manual
- development -> code_review: automatic
- code_review -> development: conditional unresolved findings + loop/approval budget
- code_review -> testing: conditional zero unresolved findings
- testing -> human_approval: conditional all mandatory checks pass
- human_approval -> merge: manual + merge approval recorded
- merge -> done: automatic

Review loop behavior:
- Findings severity includes informational, low, medium, high, critical.
- Any unresolved finding (open or dismissed not resolved) prevents testing.
- Three automatic code_review -> development loops are allowed.
- After three, one manual approval grants one extra remediation attempt.
- Loop counter does not reset automatically.
