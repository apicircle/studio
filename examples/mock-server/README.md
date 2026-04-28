# @apicircle/example-mock-server

Tiny Hono mock backend that exercises every canonical request shape
the demo workspace targets. Plan §10.1.

## Run

```sh
pnpm --filter @apicircle/example-mock-server start
```

Defaults to `http://localhost:4040`. Override with `PORT=N`.

## Endpoints

| Method   | Path               | Notes                                              |
| -------- | ------------------ | -------------------------------------------------- |
| `GET`    | `/health`          | smoke probe                                        |
| `GET`    | `/users?limit=N`   | pagination + query params                          |
| `GET`    | `/users/:id`       | path params, 404 on miss                           |
| `POST`   | `/users`           | JSON body, 201 + Location header                   |
| `PUT`    | `/users/:id`       | full replace, 404 on miss                          |
| `PATCH`  | `/users/:id`       | partial update                                     |
| `DELETE` | `/users/:id`       | 204 no body                                        |
| `POST`   | `/forms/text`      | `application/x-www-form-urlencoded` echo           |
| `POST`   | `/forms/multipart` | `multipart/form-data` with file; returns sha256    |
| `POST`   | `/binary/upload`   | raw body; returns size + sha256                    |
| `GET`    | `/auth/protected`  | requires `Authorization: Bearer demo-bearer-token` |
| `GET`    | `/slow?ms=N`       | configurable latency for duration assertions       |
| `GET`    | `/echo-headers`    | reflects request headers                           |
| `GET`    | `/json-tree`       | nested JSON for json-path assertions               |
| `GET`    | `/error/:code`     | returns the requested status (100–599)             |
| `POST`   | `/graphql`         | trivial `{ greeting }` resolver                    |

## Bearer token

Override the protected-route bearer with `MOCK_BEARER_TOKEN=<value>`
when running tests / demos that don't want the default.
