// A minimal stand-in for the Vercel/Node response the proxy handler writes to.
export function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    json(value: unknown) {
      res.body = value;
      return res;
    },
    send(value: unknown) {
      res.body = value;
      return res;
    },
  };
  return res;
}
