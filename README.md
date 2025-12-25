# wizard

an exact clone of arc news forum software built with deno + typescript.

## overview

this project aims for binary http api compatibility with the original arc news codebase. it replicates the algorithms, logical flow, trade-offs, data store layout, and html templates of arc3.2.

## features

- **voting system** - upvotes, downvotes (200+ karma required), sockpuppet detection, karma bombing prevention
- **ranking algorithms** - hot ranking with gravity decay, best, active, newest sorting
- **comment threading** - nested comments with parent/kids linking, depth-based reply delays
- **moderation** - flags, auto-kill at 7+ flags, dead/deleted visibility rules
- **admin tools** - flagged items, killed items, bad users, banned sites, banned ips
- **polls** - create polls, add options, vote on poll options
- **procrastination mode** - configurable time limits for forum access
- **user profiles** - karma, about, email, custom header colours
- **rss feed** - standard rss output for stories

## requirements

- [deno](https://deno.land/) 2.0+

## installation

```bash
git clone <repo-url>
cd wizard
```

## usage

### run the server

```bash
deno task dev
```

server starts on `http://localhost:8080` by default.

### run tests

```bash
deno task test
```

### other tasks

```bash
deno task check   # type check
deno task fmt     # format code
deno task lint    # lint code
```

## project structure

```
src/
  main.ts        # http server and route handlers
  lib/
    storage.ts   # json file storage layer
    schemas.ts   # zod data models (profile, item, vote)
    ranking.ts   # ranking algorithms
    voting.ts    # vote validation and processing
    html.ts      # template generation
    auth.ts      # authentication and sessions
    server.ts    # http utilities
data/
  config.json    # site configuration
  profile/       # user profiles
  item/          # stories, comments, polls
  vote/          # vote records per user
tests/
  e2e/           # end-to-end tests (213 tests)
```

## configuration

site settings in `data/config.json`:

- `thisSite` - site name
- `siteUrl` - base url
- `siteDesc` - site description
- `siteColour` - header background colour
- `borderColour` - border colour
- `faviconUrl` - favicon path
- `logoUrl` - logo path

## differences from arc3.2

- **runtime**: deno + typescript instead of arc lisp
- **storage**: json files instead of lisp s-expressions
- **passwords**: supports both sha512 (anarki style) and original format
- **layout**: supports hacker news style full-width mobile layout

## routes

### public

`/` `/news` `/newest` `/best` `/bestcomments` `/active` `/item` `/user` `/submitted` `/threads` `/newcomments` `/leaders` `/rss` `/lists` `/saved` `/noobstories` `/noobcomments`

### authenticated

`/submit` `/vote` `/comment` `/reply` `/edit` `/flag` `/newpoll` `/addopt`

### admin

`/newsadmin` `/flagged` `/killed` `/scrubrules` `/editors` `/badguys` `/badsites` `/badips`
