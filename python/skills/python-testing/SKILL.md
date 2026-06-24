---
name: python-testing
description: pytest craft a linter can't enforce — mocking patterns, fixture-scope decisions, edge-case and naming conventions, TDD import-safety. Applies when editing Python test files.
paths:
  - "**/test_*.py"
  - "**/*_test.py"
  - "**/tests/**/*.py"
  - "**/conftest.py"
user-invocable: false
---

A ruff + type-check gate runs on stop. Write gate-clean tests the **first time** using the
checklist, then apply the craft beneath it — the design judgment the gate can't check.

**Defer to the project.** The gate runs the repo's own config (ruff falls back to the
plugin's bundled `ruff.toml` only when the repo defines none); match the repo's existing
test conventions — mocking library, fixture layout, naming, docstring style — over the
defaults here wherever they differ. Skim a neighbouring test file before adding new patterns.

## Gate-clean checklist — write it this way first time (unless the repo differs)

- **Typed** *(universal)*: `def test_...() -> None:`; annotate fixtures and their return types.
- **Imports at top** *(universal)*: no inline imports. (Only exception: a not-yet-implemented
  class under TDD — see "TDD import-safety" below.)
- **Exceptions** *(universal)*: `with pytest.raises(SomeError, match=r"^…$"):` — never try/except.
- **Docstrings**: single-line, in the repo's convention.

## Mocking

Match the repo's mocking approach. If it uses **pytest-mock** (the recommended default),
prefer `mocker` over `monkeypatch` / `unittest.mock` directly:

- Env vars: `mocker.patch.dict(os.environ, {"VAR": "value"})` (NOT `monkeypatch.setenv`)
- Dict items / registries: `mocker.patch.dict(the_dict, {key: value})`
- Attributes/functions: `mocker.patch(...)` / `mocker.patch.object(...)`

For repository/service mocks, `AsyncMock(spec=Repository)` beats `create_autospec` (avoids `# type: ignore`):

```python
@pytest.fixture
def mock_repo() -> AsyncMock:
    """Mock repository for testing."""
    mock = AsyncMock(spec=UserRepository)
    mock._model_class = User
    return mock
```

## Exceptions

- Test with `pytest.raises`, never try/except.
- Always pass `match=`; use raw strings and `^…$` anchors for exact matching:
  `with pytest.raises(ValidationError, match=r"^Input cannot be empty$"):`

## Before writing a test — decision tree

1. Can I extend an existing parameterized test? → add parameter values
2. Can I convert an existing test to parameterized? → convert and add both cases
3. Is there setup to extract into a fixture? → extract first
4. Does a `conftest.py` already have a fixture I can use? → use it
5. Only then write a new test function

## Fixture scope

- Used by ONE file → define it in that file, not a conftest.
- Used across one domain/package → that package's `conftest.py`.
- Used broadly → the top-level `tests/conftest.py`.
- Never duplicate a fixture that exists at a higher level; never push a one-file fixture up to a shared conftest.

## What to test

- DON'T test: trivial data classes, Pydantic models with only field definitions, plain assignment.
- DO test: validation logic, computed properties, business methods, transformations, error paths.
- Edge cases are mandatory: `[]`, `{}`, `""`, `None`, `0`, `-1`, boundaries, invalid types.

## Naming (active verbs)

`test_raises_<error>_when_<condition>`, `test_<verb>_<action>_successfully`,
`test_<verb>_<object>_with_<condition>`, `test_<verb>_<field>_<constraint>`.
Active form: creates / raises / validates (not creating / created). Match the repo if it
uses a different convention.

## TDD import-safety

A top-level import of a not-yet-implemented class fails collection for the **whole file**.
While writing tests first, don't import it at the top — check by name instead:

```python
# Instead of: from app.domains.foo.schemas import NewSchema
assert type(result).__name__ == "NewSchema"
```

Swap to a real import + `isinstance` once the class exists.

## Asserting SQL structure (without a DB)

To verify a repository builds the right query, stringify the statement off the mock session:

```python
stmt = str(mock_session.exec.call_args[0][0]).lower()
assert "is_active" in stmt and "where" in stmt
```

Use for structural checks only; integration tests cover real results.
