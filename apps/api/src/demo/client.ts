// A minimal API client for the demo seeder: one cookie jar per signed-in user, CSRF and Origin
// headers like the web app sends. Any non-2xx response throws with the API's error message.
export class DemoClient {
  private cookies = new Map<string, string>();
  private csrf = '';

  constructor(
    private readonly base: string,
    private readonly origin: string,
  ) {}

  static async signIn(base: string, origin: string, email: string, password: string) {
    const c = new DemoClient(base, origin);
    c.csrf = (await c.call<{ csrfToken: string }>('GET', '/auth/csrf')).csrfToken;
    c.csrf = (
      await c.call<{ csrfToken: string }>('POST', '/auth/login', { email, password })
    ).csrfToken;
    return c;
  }

  /** An anonymous client (accepting invitations). */
  static async anonymous(base: string, origin: string) {
    const c = new DemoClient(base, origin);
    c.csrf = (await c.call<{ csrfToken: string }>('GET', '/auth/csrf')).csrfToken;
    return c;
  }

  get = <T>(path: string) => this.call<T>('GET', path);
  post = <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    this.call<T>('POST', path, body, headers);
  put = <T>(path: string, body: unknown) => this.call<T>('PUT', path, body);
  patch = <T>(path: string, body: unknown) => this.call<T>('PATCH', path, body);

  async upload<T>(path: string, name: string, type: string, data: Buffer) {
    return this.call<T>('POST', path, data, {
      'X-File-Name': encodeURIComponent(name),
      'Content-Type': type,
    });
  }

  async call<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(`${this.base}/api/v1${path}`, {
      method,
      headers: {
        Origin: this.origin,
        Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(this.csrf ? { 'X-CSRF-Token': this.csrf } : {}),
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? new Uint8Array(body) : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair = ''] = c.split(';');
      const i = pair.indexOf('=');
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const e = json?.error;
      const fields = e?.fieldErrors ? ` ${JSON.stringify(e.fieldErrors)}` : '';
      throw new Error(`${method} ${path} → ${res.status} ${e?.code}: ${e?.message}${fields}`);
    }
    return json?.data as T;
  }
}
