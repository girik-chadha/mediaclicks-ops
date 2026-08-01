'use client'

import { useEffect, useState } from 'react'

/* Moves into the avatar menu at the shell step — the design puts the theme
   switch there (`avatarMenuItems`), not in a floating control. Standalone for
   now so the token specimen can exercise both themes. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.getAttribute('data-theme') === 'dark')
  }, [])

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light')
    localStorage.setItem('theme', next ? 'dark' : 'light')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="h-8 cursor-pointer rounded-sm border border-rule bg-surface px-3 text-label transition-colors duration-[80ms] hover:border-signal"
    >
      {dark ? 'Light mode' : 'Dark mode'}
    </button>
  )
}
