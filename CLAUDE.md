you are building a clone of arc news (`./arc3.2`) with deno. your goal is to _clone it exactly_, including:

- algorithms
- logical flow
- trade offs
- data store layout
- exact html templates

you are aiming for exact http api binary compatibility, full feature completeness with no differences.

## differences

- use deno + typescript
- use json files instead of lisp s expression files
- use anarki's (`./anarki`) password style with sha512, supporting both the original version and this hash style. support data migration from anarki to this new version.
- support hacker news style full width mobile layout

## resources

- `./arc3.2` – original arc news codebase
- `https://docs.deno.com/llms.txt` – deno's docs
- `https://jsr.io/` – jsr package registry
- `https://jsr.io/@zod/zod` – zod parsing library
- `http://arclanguage.org/forum` – original/near-original code running live
- `https://news.ycombinator.com/` – similar to original code running live, expect many deviations

## rules

- do not use a web framework. built around deno's standard libraries
- only import packages when needed and from the jsr, do not use npm
- for algorithms, put relevant arc code as a code comment above new typescript code
- use zod to stringify/parse at every io boundary
- never use `any`
- use lowercase for all documentation
- use british spelling in code, commits, documentation
- build tests for everything and get full code coverage
- save/read the implementation plan from `PLAN.md` – update as needed
- only alow _one request_ to be processed at a time to avoid any data races
  - this might be a custom config with deno as it's built to be async! or just put requests in a promise queue
- use `curl` instead of web fetch unless against documentation
- update `README.md` as needed

## coding flow

- always check `PLAN.md`
  - update when you find new bugs, things missing, or work to do
  - update when work is completed
  - read at startup
- at every implementation step
  - check the relevant part of original code in `./arc3.2`
  - implement accordingly, adding original arc code as a comment above where complex or algorithmic
  - use `deno fmt` and `deno check` to check code completeness
  - commit after every meaningful step with a short, concise, descriptive name in all lower case
