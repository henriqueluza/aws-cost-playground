"""Testes do plan-guard. Rodam com `python3 -m unittest discover -s infra/tools/tests`."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import plan_guard  # noqa: E402


def plan_with(*changes: tuple[str, list[str]]) -> dict[str, Any]:
    return {
        "format_version": "1.2",
        "resource_changes": [
            {"address": address, "change": {"actions": actions}} for address, actions in changes
        ],
    }


def run_guard(content: str | None, *extra: str) -> tuple[int, str, str]:
    """Roda `main` com `content` gravado num arquivo (ou sem arquivo, se None)."""
    stdout, stderr = io.StringIO(), io.StringIO()
    with tempfile.TemporaryDirectory() as folder:
        argv = list(extra)
        if content is not None:
            path = Path(folder) / "plan.json"
            path.write_text(content, encoding="utf-8")
            argv.insert(0, str(path))
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = plan_guard.main(argv)
    return code, stdout.getvalue(), stderr.getvalue()


class SafePlans(unittest.TestCase):
    def test_create_update_read_and_noop_pass(self) -> None:
        plan = plan_with(
            ("aws_s3_bucket.site", ["create"]),
            ("aws_lambda_function.api", ["update"]),
            ("data.aws_caller_identity.current", ["read"]),
            ("aws_dynamodb_table.main", ["no-op"]),
        )
        code, out, err = run_guard(json.dumps(plan))
        self.assertEqual((code, out, err), (0, "plan-guard: nenhuma ação destrutiva\n", ""))

    def test_plan_without_resource_changes_passes(self) -> None:
        self.assertEqual(run_guard('{"format_version": "1.2"}')[0], 0)


class DestructivePlans(unittest.TestCase):
    def test_delete_is_blocked(self) -> None:
        code, out, _ = run_guard(json.dumps(plan_with(("aws_dynamodb_table.main", ["delete"]))))
        self.assertEqual((code, out), (1, "delete\taws_dynamodb_table.main\tdelete\n"))

    def test_replace_is_blocked_in_both_orders(self) -> None:
        plan = plan_with(
            ("aws_cognito_user_pool.users", ["delete", "create"]),
            ("aws_s3_bucket.site", ["create", "delete"]),
        )
        code, out, _ = run_guard(json.dumps(plan))
        self.assertEqual(code, 1)
        self.assertEqual(
            out.splitlines(),
            [
                "replace\taws_cognito_user_pool.users\tdelete,create",
                "replace\taws_s3_bucket.site\tcreate,delete",
            ],
        )

    def test_forget_is_blocked(self) -> None:
        plan = plan_with(("aws_s3_bucket.a", ["forget"]), ("aws_s3_bucket.b", ["create", "forget"]))
        code, out, _ = run_guard(json.dumps(plan))
        self.assertEqual(code, 1)
        self.assertEqual(
            out.splitlines(),
            ["forget\taws_s3_bucket.a\tforget", "forget\taws_s3_bucket.b\tcreate,forget"],
        )

    def test_reports_only_destructive_resources_in_plan_order(self) -> None:
        plan = plan_with(("a.keep", ["update"]), ("a.gone", ["delete"]), ("a.new", ["create"]))
        found = plan_guard.find_destructive(plan)
        self.assertEqual(found, [plan_guard.DestructiveChange("a.gone", ("delete",))])

    def test_control_characters_cannot_forge_report_lines(self) -> None:
        plan = plan_with(('a.b["x\ndelete\tfake"]', ["delete"]))
        _, out, _ = run_guard(json.dumps(plan))
        self.assertEqual(out, 'delete\ta.b["x\\x0adelete\\x09fake"]\tdelete\n')

    def test_report_never_prints_plan_values(self) -> None:
        plan = plan_with(("aws_ssm_parameter.key", ["delete"]))
        plan["resource_changes"][0]["change"]["before"] = {"value": "valor-do-plano"}
        self.assertNotIn("valor-do-plano", "".join(run_guard(json.dumps(plan))[1:]))


def importing(address: str, actions: list[str], value: Any = None) -> dict[str, Any]:
    """Um plano com um recurso em importação, no formato do `terraform show -json` 1.16."""
    plan = plan_with((address, actions))
    plan["resource_changes"][0]["change"]["importing"] = {"id": "abc-123"} if value is None else value
    return plan


class ImportPlans(unittest.TestCase):
    def test_import_is_blocked_even_when_nothing_else_changes(self) -> None:
        code, out, err = run_guard(json.dumps(importing("aws_s3_bucket.site", ["no-op"])))
        self.assertEqual((code, out, err), (1, "import\taws_s3_bucket.site\tno-op\n", ""))

    def test_import_with_update_or_create_is_blocked(self) -> None:
        for actions in (["update"], ["create"]):
            with self.subTest(actions=actions):
                code, out, _ = run_guard(json.dumps(importing("a.b", actions)))
                self.assertEqual((code, out), (1, f"import\ta.b\t{actions[0]}\n"))

    def test_import_by_identity_or_unknown_id_is_blocked(self) -> None:
        for value in ({"identity": {"account_id": "1", "bucket": "b"}}, {"unknown": True}, {}):
            with self.subTest(value=value):
                self.assertEqual(run_guard(json.dumps(importing("a.b", ["no-op"], value)))[0], 1)

    def test_destructive_kind_wins_over_import(self) -> None:
        code, out, _ = run_guard(json.dumps(importing("a.b", ["delete", "create"])))
        self.assertEqual((code, out), (1, "replace\ta.b\tdelete,create\n"))

    def test_null_or_absent_importing_is_not_an_import(self) -> None:
        plan = plan_with(("a.null", ["update"]), ("a.absent", ["no-op"]))
        plan["resource_changes"][0]["change"]["importing"] = None
        self.assertEqual(run_guard(json.dumps(plan))[0], 0)

    def test_import_is_reported_with_the_other_blocked_resources_in_plan_order(self) -> None:
        plan = plan_with(("a.gone", ["delete"]), ("a.keep", ["update"]), ("a.in", ["update"]))
        plan["resource_changes"][2]["change"]["importing"] = {"id": "valor-do-plano"}
        code, out, _ = run_guard(json.dumps(plan))
        self.assertEqual((code, out), (1, "delete\ta.gone\tdelete\nimport\ta.in\tupdate\n"))
        self.assertEqual(
            plan_guard.find_destructive(plan),
            [
                plan_guard.DestructiveChange("a.gone", ("delete",)),
                plan_guard.DestructiveChange("a.in", ("update",), importing=True),
            ],
        )

    def test_importing_that_is_not_an_object_fails_closed(self) -> None:
        for value in (True, False, "abc-123", 0, ["id"]):
            with self.subTest(value=value):
                plan = plan_with(("a.b", ["no-op"]))
                plan["resource_changes"][0]["change"]["importing"] = value
                code, out, err = run_guard(json.dumps(plan))
                self.assertEqual((code, out), (2, ""))
                self.assertIn("`importing` inválido", err)


class ErroredPlans(unittest.TestCase):
    def test_errored_plan_is_invalid_input_even_without_destructive_actions(self) -> None:
        for plan in (plan_with(("a.b", ["create"])), plan_with(("a.b", ["delete"])), plan_with()):
            with self.subTest(plan=plan):
                code, out, err = run_guard(json.dumps({**plan, "errored": True}))
                self.assertEqual((code, out), (2, ""))
                self.assertEqual(err, "plan-guard: entrada inválida (o plano terminou com erro (`errored: true`))\n")

    def test_plan_without_errored_or_with_errored_false_is_read_normally(self) -> None:
        safe, destructive = plan_with(("a.b", ["update"])), plan_with(("a.b", ["delete"]))
        self.assertEqual(run_guard(json.dumps(safe))[0], 0)
        self.assertEqual(run_guard(json.dumps({**safe, "errored": False}))[0], 0)
        self.assertEqual(run_guard(json.dumps({**destructive, "errored": False}))[0], 1)

    def test_errored_that_is_not_a_boolean_fails_closed(self) -> None:
        for value in (None, "true", 1, 0, []):
            with self.subTest(value=value):
                code, out, _ = run_guard(json.dumps({**plan_with(("a.b", ["update"])), "errored": value}))
                self.assertEqual((code, out), (2, ""))


class InvalidInput(unittest.TestCase):
    def assert_fails_closed(self, result: tuple[int, str, str]) -> None:
        code, out, err = result
        self.assertEqual((code, out), (2, ""))
        self.assertTrue(err.startswith(("plan-guard: entrada inválida", "uso:")))

    def test_missing_or_extra_arguments(self) -> None:
        self.assert_fails_closed(run_guard(None))
        self.assert_fails_closed(run_guard("{}", "outro.json"))

    def test_unreadable_file(self) -> None:
        self.assert_fails_closed(run_guard(None, "/caminho/que/nao/existe.json"))

    def test_malformed_content(self) -> None:
        item = {"address": "a.b", "change": {"actions": ["delete"]}}
        cases: list[Any] = [
            [],
            {},
            {"resource_changes": [item]},
            {"format_version": "1.2", "resource_changes": {"a": 1}},
            {"format_version": "1.2", "resource_changes": [None]},
            {"format_version": "1.2", "resource_changes": [{"change": item["change"]}]},
            {"format_version": "1.2", "resource_changes": [{"address": "a.b"}]},
            {"format_version": "1.2", "resource_changes": [{"address": "a.b", "change": {}}]},
            {"format_version": "1.2", "resource_changes": [{**item, "change": {"actions": "delete"}}]},
            {"format_version": "1.2", "resource_changes": [{**item, "change": {"actions": [1]}}]},
            plan_with(("a.b", ["DELETE"])),
            plan_with(("a.b", ["update", "ação-nova"])),
        ]
        for case in cases:
            with self.subTest(case=case):
                self.assert_fails_closed(run_guard(json.dumps(case)))
        for raw in ("", "não é json", '{"format_version": "1.2"', "[" * 100_000):
            with self.subTest(raw=raw[:20]):
                self.assert_fails_closed(run_guard(raw))

    def test_error_message_does_not_echo_the_file(self) -> None:
        _, _, err = run_guard('{"format_version": "1.2", "segredo": "valor-do-plano"')
        self.assertNotIn("valor-do-plano", err)


if __name__ == "__main__":
    unittest.main()
