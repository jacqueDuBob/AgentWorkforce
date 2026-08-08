insert into owner_profiles (id, email, display_name)
values ('b90fddd2-42c5-44f4-9172-9922db8e95b7', 'owner@example.com', 'Local Owner')
on conflict (id) do nothing;

insert into boards (id, owner_profile_id, name)
values ('7f951bea-4fc8-4f8a-8548-5b898ba73488', 'b90fddd2-42c5-44f4-9172-9922db8e95b7', 'AgentBoard MVP')
on conflict (id) do nothing;

insert into repositories (id, owner_profile_id, full_name, default_branch, enabled)
values
  ('7e07a67e-5f16-4c34-b793-f8e177f2625f', 'b90fddd2-42c5-44f4-9172-9922db8e95b7', 'acme/web-portal', 'main', true),
  ('f788c732-bddd-4287-84fa-f3237ca3cd88', 'b90fddd2-42c5-44f4-9172-9922db8e95b7', 'acme/api-gateway', 'main', true)
on conflict do nothing;

insert into workflow_definitions (id, board_id, key, version)
values ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', '7f951bea-4fc8-4f8a-8548-5b898ba73488', 'software-development', '1.0.0')
on conflict do nothing;

insert into workflow_stages (workflow_definition_id, stage_id, label, order_index)
values
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'inbox', 'Inbox', 1),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'classification', 'Classification', 2),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'refinement', 'Refinement', 3),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'planning', 'Planning', 4),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'development', 'Development', 5),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'code_review', 'Code Review', 6),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'testing', 'Testing', 7),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'human_approval', 'Human Approval', 8),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'merge', 'Merge', 9),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'done', 'Done', 10)
on conflict do nothing;

insert into transition_policies (workflow_definition_id, from_stage_id, to_stage_id, mode, condition)
values
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'inbox', 'classification', 'automatic', '{"kind":"always"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'classification', 'refinement', 'automatic', '{"kind":"always"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'refinement', 'planning', 'manual', '{"kind":"always"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'planning', 'development', 'manual', '{"kind":"always"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'development', 'code_review', 'automatic', '{"kind":"always"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'code_review', 'development', 'conditional', '{"kind":"unresolved_findings_and_loop_available"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'code_review', 'testing', 'conditional', '{"kind":"zero_unresolved_findings"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'testing', 'human_approval', 'conditional', '{"kind":"all_mandatory_checks_pass"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'human_approval', 'merge', 'manual', '{"kind":"merge_approval_recorded"}'),
  ('42d139bd-ee57-4f0c-ae5f-71350ec5e707', 'merge', 'done', 'automatic', '{"kind":"always"}')
on conflict do nothing;
