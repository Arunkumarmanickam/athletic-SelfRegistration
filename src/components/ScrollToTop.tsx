import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export function ScrollToTop() {
  const { pathname, search } = useLocation()

  useEffect(() => {
    // Scroll to top on every route change or query change
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    // Fallback for some browsers
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
  }, [pathname, search])

  return null
}
