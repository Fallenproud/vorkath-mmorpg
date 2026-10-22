export type ManusSession =
  | { status: 'authenticated'; user: { id: number; name: string | null } }
  | { status: 'logged_out' | 'offline'; user: null }

export declare const ManusAuth: Readonly<{
  prepare(): Promise<ManusSession>
  login(): Promise<void>
  logout(): Promise<ManusSession>
  startGame(start: (session: ManusSession) => unknown | Promise<unknown>): Promise<ManusSession>
  invoke(operation: 'login' | 'logout', done: (error: string) => void): void
  get_session(): ManusSession | null
  query<T = unknown>(procedure: string, input?: unknown): Promise<T>
  mutate<T = unknown>(procedure: string, input?: unknown): Promise<T>
  open_standalone(): void
}>

declare global {
  interface Window {
    ManusAuth: typeof ManusAuth
  }
  interface WindowEventMap {
    'manus-auth-change': CustomEvent<ManusSession>
  }
}
