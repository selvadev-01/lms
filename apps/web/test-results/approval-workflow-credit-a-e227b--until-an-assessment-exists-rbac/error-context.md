# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: approval-workflow.spec.ts >> credit assessment gates approval >> Scenario 8 — approval is refused until an assessment exists
- Location: e2e\approval-workflow.spec.ts:291:7

# Error details

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:3001
Call log:
  - → POST http://localhost:3001/api/v1/auth/sign-in
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 67
    - cookie: lms_at=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjk4NTEyNy0yYTVjLTQ3NTAtODRjMi0yNGFlYWUyZTJiMjMiLCJvcmdJZCI6IjhkZjRjNzUyLWI3ZGItNDQwYi1hMWEyLTUxMzVjYTNlNDQ3OCIsIm9yZ0NvZGUiOiJERU1PIiwic2lkIjoiNWNhNWY2MzgtZmE3Zi00YTU4LWJhNmMtZjBkMzE5NzEwOTYwIiwiYnJhbmNoSWQiOm51bGwsInJvbGVzIjpbIlNVUEVSX0FETUlOIl0sImlhdCI6MTc4Nzc5NDIzMCwiZXhwIjoxNzg3Nzk1MTMwfQ.20Brnwe3-Izr9EuVMvPbpUHu6zvc6zTN2D0P0EsoGPU; lms_rt=s6H5U2N6nFSJbdRjFhlHlTci3gRNwIFUqXpujOZJ0TY

```

```
Error: apiRequestContext.post: connect ECONNREFUSED ::1:3001
Call log:
  - → POST http://localhost:3001/api/v1/auth/sign-in
    - user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.7922.34 Safari/537.36
    - accept: */*
    - accept-encoding: gzip,deflate,br
    - content-type: application/json
    - content-length: 67
    - cookie: lms_at=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMjk4NTEyNy0yYTVjLTQ3NTAtODRjMi0yNGFlYWUyZTJiMjMiLCJvcmdJZCI6IjhkZjRjNzUyLWI3ZGItNDQwYi1hMWEyLTUxMzVjYTNlNDQ3OCIsIm9yZ0NvZGUiOiJERU1PIiwic2lkIjoiNWNhNWY2MzgtZmE3Zi00YTU4LWJhNmMtZjBkMzE5NzEwOTYwIiwiYnJhbmNoSWQiOm51bGwsInJvbGVzIjpbIlNVUEVSX0FETUlOIl0sImlhdCI6MTc4Nzc5NDIzMCwiZXhwIjoxNzg3Nzk1MTMwfQ.20Brnwe3-Izr9EuVMvPbpUHu6zvc6zTN2D0P0EsoGPU; lms_rt=s6H5U2N6nFSJbdRjFhlHlTci3gRNwIFUqXpujOZJ0TY

```