// The data files under /_data are for the API only (read through the ASSETS binding); keep them off the public site.
export const onRequest = () => new Response('Not found', { status: 404 })
