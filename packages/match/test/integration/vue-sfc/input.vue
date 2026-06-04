<template>
  <h1>{{ title }}</h1>
</template>

<script setup lang="ts">
const title = "App"
if (BATI.has("auth")) {
  useAuth()
} else {
  useGuest()
}
</script>

<style scoped>
h1 { color: red }
</style>
