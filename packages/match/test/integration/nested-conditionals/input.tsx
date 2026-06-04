export function Page() {
  if ($$.BATI.has("auth")) {
    if ($$.BATI.has("admin")) {
      return <Admin />
    } else {
      return <User />
    }
  } else {
    return <Guest />
  }
}
