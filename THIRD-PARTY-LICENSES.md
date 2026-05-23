# Third-Party Licenses

API Circle Studio bundles or depends on the open-source packages listed
below. We are grateful to their authors and maintainers. Each package is
distributed under its own license; the table records the license SPDX
identifier and a link to the project's homepage so the full license text
can be retrieved.

Build artifacts (the npm packages under `@apicircle/*`, the desktop
installers, and the web build deployed to `studio.apicircle.dev`) include
copies of these packages or their transpiled output. The license terms of
each package continue to apply to the bundled copy.

This file is regenerated from the project's production dependency tree.
It tracks **runtime production dependencies only** — development tools
(test runners, bundlers, linters, type-only `@types/*` packages used
purely at compile time) are excluded because they are not redistributed
in any shipped artifact. The table is sorted alphabetically by package
name.

## How to obtain a license text

For each package below, the canonical license text is included in the
package's published tarball (typically at `LICENSE`, `LICENSE.md`, or
`license.txt`). After installing via `pnpm install`, the file is
available at `node_modules/<package>/LICENSE`. The homepage link in the
table also points at the upstream repository or website where the
license is published.

## Licenses in use

The dependency tree currently uses the following license families:

- **MIT** — the large majority of packages.
- **ISC** — functionally equivalent to MIT; used by several `npm`,
  `lucide`, and `isaacs` packages.
- **BSD-2-Clause** and **BSD-3-Clause** — `json-schema-typed`, `qs`,
  `fast-uri`.
- **Python-2.0** — `argparse` (a port of the Python standard library
  module).
- **BlueOak-1.0.0** — `sax`.

All of these are permissive licenses compatible with redistribution
under the [API Circle Studio License](LICENSE).

## Packages

| Package                               | Version | License       | Homepage                                                                                                                                                               |
| ------------------------------------- | ------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@apidevtools/json-schema-ref-parser` | 11.7.2  | MIT           | [apitools.dev/json-schema-ref-parser](https://apitools.dev/json-schema-ref-parser/)                                                                                    |
| `@apidevtools/openapi-schemas`        | 2.1.0   | MIT           | [apitools.dev/openapi-schemas](https://apitools.dev/openapi-schemas)                                                                                                   |
| `@apidevtools/swagger-methods`        | 3.0.2   | MIT           | [github.com/APIDevTools/swagger-methods](https://github.com/APIDevTools/swagger-methods)                                                                               |
| `@apidevtools/swagger-parser`         | 10.1.1  | MIT           | [apitools.dev/swagger-parser](https://apitools.dev/swagger-parser/)                                                                                                    |
| `@hono/node-server`                   | 1.19.14 | MIT           | [github.com/honojs/node-server](https://github.com/honojs/node-server)                                                                                                 |
| `@jsdevtools/ono`                     | 7.1.3   | MIT           | [jstools.dev/ono](https://jstools.dev/ono)                                                                                                                             |
| `@modelcontextprotocol/sdk`           | 1.29.0  | MIT           | [modelcontextprotocol.io](https://modelcontextprotocol.io)                                                                                                             |
| `@monaco-editor/loader`               | 1.7.0   | MIT           | [github.com/suren-atoyan/monaco-loader.git](https://github.com/suren-atoyan/monaco-loader.git)                                                                         |
| `@monaco-editor/react`                | 4.7.0   | MIT           | [github.com/suren-atoyan/monaco-react#readme](https://github.com/suren-atoyan/monaco-react#readme)                                                                     |
| `@types/json-schema`                  | 7.0.15  | MIT           | [github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/json-schema)           |
| `@types/prop-types`                   | 15.7.15 | MIT           | [github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/prop-types](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/prop-types)             |
| `@types/react`                        | 18.3.28 | MIT           | [github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/react)                       |
| `accepts`                             | 2.0.0   | MIT           | [github.com/jshttp/accepts#readme](https://github.com/jshttp/accepts#readme)                                                                                           |
| `ajv`                                 | 8.20.0  | MIT           | [ajv.js.org](https://ajv.js.org)                                                                                                                                       |
| `ajv-draft-04`                        | 1.0.0   | MIT           | [github.com/ajv-validator/ajv-draft-04#readme](https://github.com/ajv-validator/ajv-draft-04#readme)                                                                   |
| `ajv-formats`                         | 3.0.1   | MIT           | [github.com/ajv-validator/ajv-formats#readme](https://github.com/ajv-validator/ajv-formats#readme)                                                                     |
| `argparse`                            | 2.0.1   | Python-2.0    | [github.com/nodeca/argparse#readme](https://github.com/nodeca/argparse#readme)                                                                                         |
| `body-parser`                         | 2.2.2   | MIT           | [github.com/expressjs/body-parser#readme](https://github.com/expressjs/body-parser#readme)                                                                             |
| `builder-util-runtime`                | 9.5.1   | MIT           | [github.com/electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)                                                                 |
| `bytes`                               | 3.1.2   | MIT           | [github.com/visionmedia/bytes.js#readme](https://github.com/visionmedia/bytes.js#readme)                                                                               |
| `call-bind-apply-helpers`             | 1.0.2   | MIT           | [github.com/ljharb/call-bind-apply-helpers#readme](https://github.com/ljharb/call-bind-apply-helpers#readme)                                                           |
| `call-bound`                          | 1.0.4   | MIT           | [github.com/ljharb/call-bound#readme](https://github.com/ljharb/call-bound#readme)                                                                                     |
| `call-me-maybe`                       | 1.0.2   | MIT           | [github.com/limulus/call-me-maybe#readme](https://github.com/limulus/call-me-maybe#readme)                                                                             |
| `commander`                           | 12.1.0  | MIT           | [github.com/tj/commander.js#readme](https://github.com/tj/commander.js#readme)                                                                                         |
| `content-disposition`                 | 1.1.0   | MIT           | [github.com/jshttp/content-disposition#readme](https://github.com/jshttp/content-disposition#readme)                                                                   |
| `content-type`                        | 1.0.5   | MIT           | [github.com/jshttp/content-type#readme](https://github.com/jshttp/content-type#readme)                                                                                 |
| `cookie`                              | 0.7.2   | MIT           | [github.com/jshttp/cookie#readme](https://github.com/jshttp/cookie#readme)                                                                                             |
| `cookie-signature`                    | 1.2.2   | MIT           | [github.com/visionmedia/node-cookie-signature#readme](https://github.com/visionmedia/node-cookie-signature#readme)                                                     |
| `cors`                                | 2.8.6   | MIT           | [github.com/expressjs/cors#readme](https://github.com/expressjs/cors#readme)                                                                                           |
| `cross-spawn`                         | 7.0.6   | MIT           | [github.com/moxystudio/node-cross-spawn](https://github.com/moxystudio/node-cross-spawn)                                                                               |
| `csstype`                             | 3.2.3   | MIT           | [github.com/frenic/csstype#readme](https://github.com/frenic/csstype#readme)                                                                                           |
| `debug`                               | 4.4.3   | MIT           | [github.com/debug-js/debug#readme](https://github.com/debug-js/debug#readme)                                                                                           |
| `depd`                                | 2.0.0   | MIT           | [github.com/dougwilson/nodejs-depd#readme](https://github.com/dougwilson/nodejs-depd#readme)                                                                           |
| `dunder-proto`                        | 1.0.1   | MIT           | [github.com/es-shims/dunder-proto#readme](https://github.com/es-shims/dunder-proto#readme)                                                                             |
| `ee-first`                            | 1.1.1   | MIT           | [github.com/jonathanong/ee-first#readme](https://github.com/jonathanong/ee-first#readme)                                                                               |
| `electron-updater`                    | 6.8.3   | MIT           | [github.com/electron-userland/electron-builder](https://github.com/electron-userland/electron-builder)                                                                 |
| `encodeurl`                           | 2.0.0   | MIT           | [github.com/pillarjs/encodeurl#readme](https://github.com/pillarjs/encodeurl#readme)                                                                                   |
| `es-define-property`                  | 1.0.1   | MIT           | [github.com/ljharb/es-define-property#readme](https://github.com/ljharb/es-define-property#readme)                                                                     |
| `es-errors`                           | 1.3.0   | MIT           | [github.com/ljharb/es-errors#readme](https://github.com/ljharb/es-errors#readme)                                                                                       |
| `es-object-atoms`                     | 1.1.1   | MIT           | [github.com/ljharb/es-object-atoms#readme](https://github.com/ljharb/es-object-atoms#readme)                                                                           |
| `escape-html`                         | 1.0.3   | MIT           | [github.com/component/escape-html#readme](https://github.com/component/escape-html#readme)                                                                             |
| `etag`                                | 1.8.1   | MIT           | [github.com/jshttp/etag#readme](https://github.com/jshttp/etag#readme)                                                                                                 |
| `eventsource`                         | 3.0.7   | MIT           | [github.com/EventSource/eventsource#readme](https://github.com/EventSource/eventsource#readme)                                                                         |
| `eventsource-parser`                  | 3.0.8   | MIT           | [github.com/rexxars/eventsource-parser#readme](https://github.com/rexxars/eventsource-parser#readme)                                                                   |
| `express`                             | 5.2.1   | MIT           | [expressjs.com](https://expressjs.com/)                                                                                                                                |
| `express-rate-limit`                  | 8.4.1   | MIT           | [github.com/express-rate-limit/express-rate-limit](https://github.com/express-rate-limit/express-rate-limit)                                                           |
| `fast-deep-equal`                     | 3.1.3   | MIT           | [github.com/epoberezkin/fast-deep-equal#readme](https://github.com/epoberezkin/fast-deep-equal#readme)                                                                 |
| `fast-uri`                            | 3.1.2   | BSD-3-Clause  | [github.com/fastify/fast-uri](https://github.com/fastify/fast-uri)                                                                                                     |
| `finalhandler`                        | 2.1.1   | MIT           | [github.com/pillarjs/finalhandler#readme](https://github.com/pillarjs/finalhandler#readme)                                                                             |
| `forwarded`                           | 0.2.0   | MIT           | [github.com/jshttp/forwarded#readme](https://github.com/jshttp/forwarded#readme)                                                                                       |
| `fresh`                               | 2.0.0   | MIT           | [github.com/jshttp/fresh#readme](https://github.com/jshttp/fresh#readme)                                                                                               |
| `fs-extra`                            | 10.1.0  | MIT           | [github.com/jprichardson/node-fs-extra](https://github.com/jprichardson/node-fs-extra)                                                                                 |
| `function-bind`                       | 1.1.2   | MIT           | [github.com/Raynos/function-bind](https://github.com/Raynos/function-bind)                                                                                             |
| `get-intrinsic`                       | 1.3.0   | MIT           | [github.com/ljharb/get-intrinsic#readme](https://github.com/ljharb/get-intrinsic#readme)                                                                               |
| `get-proto`                           | 1.0.1   | MIT           | [github.com/ljharb/get-proto#readme](https://github.com/ljharb/get-proto#readme)                                                                                       |
| `gopd`                                | 1.2.0   | MIT           | [github.com/ljharb/gopd#readme](https://github.com/ljharb/gopd#readme)                                                                                                 |
| `graceful-fs`                         | 4.2.11  | ISC           | [github.com/isaacs/node-graceful-fs#readme](https://github.com/isaacs/node-graceful-fs#readme)                                                                         |
| `has-symbols`                         | 1.1.0   | MIT           | [github.com/ljharb/has-symbols#readme](https://github.com/ljharb/has-symbols#readme)                                                                                   |
| `hasown`                              | 2.0.3   | MIT           | [github.com/inspect-js/hasOwn#readme](https://github.com/inspect-js/hasOwn#readme)                                                                                     |
| `hono`                                | 4.12.18 | MIT           | [hono.dev](https://hono.dev)                                                                                                                                           |
| `http-errors`                         | 2.0.1   | MIT           | [github.com/jshttp/http-errors#readme](https://github.com/jshttp/http-errors#readme)                                                                                   |
| `iconv-lite`                          | 0.7.2   | MIT           | [github.com/pillarjs/iconv-lite](https://github.com/pillarjs/iconv-lite)                                                                                               |
| `inherits`                            | 2.0.4   | ISC           | [github.com/isaacs/inherits#readme](https://github.com/isaacs/inherits#readme)                                                                                         |
| `ip-address`                          | 10.1.1  | MIT           | [github.com/beaugunderson/ip-address#readme](https://github.com/beaugunderson/ip-address#readme)                                                                       |
| `ipaddr.js`                           | 1.9.1   | MIT           | [github.com/whitequark/ipaddr.js#readme](https://github.com/whitequark/ipaddr.js#readme)                                                                               |
| `is-promise`                          | 4.0.0   | MIT           | [github.com/then/is-promise#readme](https://github.com/then/is-promise#readme)                                                                                         |
| `isexe`                               | 2.0.0   | ISC           | [github.com/isaacs/isexe#readme](https://github.com/isaacs/isexe#readme)                                                                                               |
| `jose`                                | 6.2.3   | MIT           | [github.com/panva/jose](https://github.com/panva/jose)                                                                                                                 |
| `js-tokens`                           | 4.0.0   | MIT           | [github.com/lydell/js-tokens#readme](https://github.com/lydell/js-tokens#readme)                                                                                       |
| `js-yaml`                             | 4.1.1   | MIT           | [github.com/nodeca/js-yaml#readme](https://github.com/nodeca/js-yaml#readme)                                                                                           |
| `json-schema-traverse`                | 1.0.0   | MIT           | [github.com/epoberezkin/json-schema-traverse#readme](https://github.com/epoberezkin/json-schema-traverse#readme)                                                       |
| `json-schema-typed`                   | 8.0.2   | BSD-2-Clause  | [github.com/RemyRylan/json-schema-typed/tree/main/dist/node](https://github.com/RemyRylan/json-schema-typed/tree/main/dist/node)                                       |
| `jsonfile`                            | 6.2.1   | MIT           | [github.com/jprichardson/node-jsonfile#readme](https://github.com/jprichardson/node-jsonfile#readme)                                                                   |
| `kleur`                               | 4.1.5   | MIT           | [github.com/lukeed/kleur#readme](https://github.com/lukeed/kleur#readme)                                                                                               |
| `lazy-val`                            | 1.0.5   | MIT           | [github.com/develar/lazy-val](https://github.com/develar/lazy-val)                                                                                                     |
| `lodash.escaperegexp`                 | 4.1.2   | MIT           | [lodash.com](https://lodash.com/)                                                                                                                                      |
| `lodash.isequal`                      | 4.5.0   | MIT           | [lodash.com](https://lodash.com/)                                                                                                                                      |
| `loose-envify`                        | 1.4.0   | MIT           | [github.com/zertosh/loose-envify](https://github.com/zertosh/loose-envify)                                                                                             |
| `lucide-react`                        | 0.575.0 | ISC           | [lucide.dev](https://lucide.dev)                                                                                                                                       |
| `math-intrinsics`                     | 1.1.0   | MIT           | [github.com/es-shims/math-intrinsics#readme](https://github.com/es-shims/math-intrinsics#readme)                                                                       |
| `media-typer`                         | 1.1.0   | MIT           | [github.com/jshttp/media-typer#readme](https://github.com/jshttp/media-typer#readme)                                                                                   |
| `merge-descriptors`                   | 2.0.0   | MIT           | [github.com/sindresorhus/merge-descriptors#readme](https://github.com/sindresorhus/merge-descriptors#readme)                                                           |
| `mime-db`                             | 1.54.0  | MIT           | [github.com/jshttp/mime-db#readme](https://github.com/jshttp/mime-db#readme)                                                                                           |
| `mime-types`                          | 3.0.2   | MIT           | [github.com/jshttp/mime-types#readme](https://github.com/jshttp/mime-types#readme)                                                                                     |
| `monaco-editor`                       | 0.52.2  | MIT           | [github.com/microsoft/monaco-editor](https://github.com/microsoft/monaco-editor)                                                                                       |
| `ms`                                  | 2.1.3   | MIT           | [github.com/vercel/ms#readme](https://github.com/vercel/ms#readme)                                                                                                     |
| `negotiator`                          | 1.0.0   | MIT           | [github.com/jshttp/negotiator#readme](https://github.com/jshttp/negotiator#readme)                                                                                     |
| `object-assign`                       | 4.1.1   | MIT           | [github.com/sindresorhus/object-assign#readme](https://github.com/sindresorhus/object-assign#readme)                                                                   |
| `object-inspect`                      | 1.13.4  | MIT           | [github.com/inspect-js/object-inspect](https://github.com/inspect-js/object-inspect)                                                                                   |
| `on-finished`                         | 2.4.1   | MIT           | [github.com/jshttp/on-finished#readme](https://github.com/jshttp/on-finished#readme)                                                                                   |
| `once`                                | 1.4.0   | ISC           | [github.com/isaacs/once#readme](https://github.com/isaacs/once#readme)                                                                                                 |
| `openapi-types`                       | 12.1.3  | MIT           | [github.com/kogosoftwarellc/open-api/tree/master/packages/openapi-types#readme](https://github.com/kogosoftwarellc/open-api/tree/master/packages/openapi-types#readme) |
| `parseurl`                            | 1.3.3   | MIT           | [github.com/pillarjs/parseurl#readme](https://github.com/pillarjs/parseurl#readme)                                                                                     |
| `path-key`                            | 3.1.1   | MIT           | [github.com/sindresorhus/path-key#readme](https://github.com/sindresorhus/path-key#readme)                                                                             |
| `path-to-regexp`                      | 8.4.2   | MIT           | [github.com/pillarjs/path-to-regexp#readme](https://github.com/pillarjs/path-to-regexp#readme)                                                                         |
| `pkce-challenge`                      | 5.0.1   | MIT           | [github.com/crouchcd/pkce-challenge#readme](https://github.com/crouchcd/pkce-challenge#readme)                                                                         |
| `proper-lockfile`                     | 4.1.2   | MIT           | [github.com/moxystudio/node-proper-lockfile](https://github.com/moxystudio/node-proper-lockfile)                                                                       |
| `proxy-addr`                          | 2.0.7   | MIT           | [github.com/jshttp/proxy-addr#readme](https://github.com/jshttp/proxy-addr#readme)                                                                                     |
| `qs`                                  | 6.15.1  | BSD-3-Clause  | [github.com/ljharb/qs](https://github.com/ljharb/qs)                                                                                                                   |
| `range-parser`                        | 1.2.1   | MIT           | [github.com/jshttp/range-parser#readme](https://github.com/jshttp/range-parser#readme)                                                                                 |
| `raw-body`                            | 3.0.2   | MIT           | [github.com/stream-utils/raw-body#readme](https://github.com/stream-utils/raw-body#readme)                                                                             |
| `react`                               | 18.3.1  | MIT           | [reactjs.org](https://reactjs.org/)                                                                                                                                    |
| `react-dom`                           | 18.3.1  | MIT           | [reactjs.org](https://reactjs.org/)                                                                                                                                    |
| `react-resizable-panels`              | 2.1.9   | MIT           | [github.com/bvaughn/react-resizable-panels#readme](https://github.com/bvaughn/react-resizable-panels#readme)                                                           |
| `require-from-string`                 | 2.0.2   | MIT           | [github.com/floatdrop/require-from-string#readme](https://github.com/floatdrop/require-from-string#readme)                                                             |
| `retry`                               | 0.12.0  | MIT           | [github.com/tim-kos/node-retry](https://github.com/tim-kos/node-retry)                                                                                                 |
| `router`                              | 2.2.0   | MIT           | [github.com/pillarjs/router#readme](https://github.com/pillarjs/router#readme)                                                                                         |
| `safer-buffer`                        | 2.1.2   | MIT           | [github.com/ChALkeR/safer-buffer#readme](https://github.com/ChALkeR/safer-buffer#readme)                                                                               |
| `sax`                                 | 1.6.0   | BlueOak-1.0.0 | [github.com/isaacs/sax-js#readme](https://github.com/isaacs/sax-js#readme)                                                                                             |
| `scheduler`                           | 0.23.2  | MIT           | [reactjs.org](https://reactjs.org/)                                                                                                                                    |
| `semver`                              | 7.7.4   | ISC           | [github.com/npm/node-semver#readme](https://github.com/npm/node-semver#readme)                                                                                         |
| `send`                                | 1.2.1   | MIT           | [github.com/pillarjs/send#readme](https://github.com/pillarjs/send#readme)                                                                                             |
| `serve-static`                        | 2.2.1   | MIT           | [github.com/expressjs/serve-static#readme](https://github.com/expressjs/serve-static#readme)                                                                           |
| `setprototypeof`                      | 1.2.0   | ISC           | [github.com/wesleytodd/setprototypeof](https://github.com/wesleytodd/setprototypeof)                                                                                   |
| `shebang-command`                     | 2.0.0   | MIT           | [github.com/kevva/shebang-command#readme](https://github.com/kevva/shebang-command#readme)                                                                             |
| `shebang-regex`                       | 3.0.0   | MIT           | [github.com/sindresorhus/shebang-regex#readme](https://github.com/sindresorhus/shebang-regex#readme)                                                                   |
| `side-channel`                        | 1.1.0   | MIT           | [github.com/ljharb/side-channel#readme](https://github.com/ljharb/side-channel#readme)                                                                                 |
| `side-channel-list`                   | 1.0.1   | MIT           | [github.com/ljharb/side-channel-list#readme](https://github.com/ljharb/side-channel-list#readme)                                                                       |
| `side-channel-map`                    | 1.0.1   | MIT           | [github.com/ljharb/side-channel-map#readme](https://github.com/ljharb/side-channel-map#readme)                                                                         |
| `side-channel-weakmap`                | 1.0.2   | MIT           | [github.com/ljharb/side-channel-weakmap#readme](https://github.com/ljharb/side-channel-weakmap#readme)                                                                 |
| `signal-exit`                         | 3.0.7   | ISC           | [github.com/tapjs/signal-exit](https://github.com/tapjs/signal-exit)                                                                                                   |
| `state-local`                         | 1.0.7   | MIT           | [github.com/suren-atoyan/state-local#readme](https://github.com/suren-atoyan/state-local#readme)                                                                       |
| `statuses`                            | 2.0.2   | MIT           | [github.com/jshttp/statuses#readme](https://github.com/jshttp/statuses#readme)                                                                                         |
| `tiny-typed-emitter`                  | 2.1.0   | MIT           | [github.com/binier/tiny-typed-emitter#readme](https://github.com/binier/tiny-typed-emitter#readme)                                                                     |
| `toidentifier`                        | 1.0.1   | MIT           | [github.com/component/toidentifier#readme](https://github.com/component/toidentifier#readme)                                                                           |
| `type-is`                             | 2.0.1   | MIT           | [github.com/jshttp/type-is#readme](https://github.com/jshttp/type-is#readme)                                                                                           |
| `universalify`                        | 2.0.1   | MIT           | [github.com/RyanZim/universalify#readme](https://github.com/RyanZim/universalify#readme)                                                                               |
| `unpipe`                              | 1.0.0   | MIT           | [github.com/stream-utils/unpipe#readme](https://github.com/stream-utils/unpipe#readme)                                                                                 |
| `use-sync-external-store`             | 1.6.0   | MIT           | [github.com/facebook/react#readme](https://github.com/facebook/react#readme)                                                                                           |
| `vary`                                | 1.1.2   | MIT           | [github.com/jshttp/vary#readme](https://github.com/jshttp/vary#readme)                                                                                                 |
| `which`                               | 2.0.2   | ISC           | [github.com/isaacs/node-which#readme](https://github.com/isaacs/node-which#readme)                                                                                     |
| `wrappy`                              | 1.0.2   | ISC           | [github.com/npm/wrappy](https://github.com/npm/wrappy)                                                                                                                 |
| `zod`                                 | 3.25.76 | MIT           | [zod.dev](https://zod.dev)                                                                                                                                             |
| `zod-to-json-schema`                  | 3.25.2  | ISC           | [github.com/StefanTerdell/zod-to-json-schema#readme](https://github.com/StefanTerdell/zod-to-json-schema#readme)                                                       |
| `zustand`                             | 4.5.7   | MIT           | [github.com/pmndrs/zustand](https://github.com/pmndrs/zustand)                                                                                                         |
