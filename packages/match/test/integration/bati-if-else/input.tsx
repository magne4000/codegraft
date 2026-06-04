export function Page() {
  if (BATI.has("auth")) {
    return <Dashboard />
  } else {
    return <Landing />
  }
}
