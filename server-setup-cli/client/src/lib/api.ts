import axios from 'axios'

// Base API URL configurable via Vite env, falls back to '/api'
export const API_URL: string = import.meta.env.VITE_API_URL ?? '/api'

// Single axios instance for the app's backend API
export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Optional: add interceptors here (headers, logging, error normalization)
// api.interceptors.request.use((config) => {
//   // e.g., attach auth tokens
//   return config
// })
// api.interceptors.response.use(
//   (response) => response,
//   (error) => {
//     // e.g., map backend error shape to a standard Error
//     return Promise.reject(error)
//   },
// )
