# Large Build/Test Demo Task

## Objective

Run a more substantial engineering workflow than the terminal-agent scenario and make the scale-up path visible.

## Required step sequence

1. identify repo entrypoint for build/test work
2. state that the task is using the large execution profile
3. run preflight checks
4. run build and/or test commands
5. collect logs or failing output
6. summarize outcome and follow-up

## Preferred evidence

Use real commands such as:
- repo inspection commands
- dependency/toolchain checks
- `make`, `cmake`, `pytest`, `npm test`, or equivalent project-specific commands
- targeted log extraction

## Not acceptable

- only saying that scale-up happened
- returning a generic build summary with no command evidence
- skipping failure detail when the task fails
