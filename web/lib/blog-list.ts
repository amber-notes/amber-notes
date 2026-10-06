/// Whether a path is one of the blog's lists: the index, a category, or a later page of either.
/// Moving between them is switching a filter, so the site keeps the title and chips still
/// (app/SiteChrome.tsx, lib/BlogList.tsx). Its own file, so the client gets this and not the posts.
export const isBlogList = (path: string) => /^\/blog(\/category\/[a-z0-9-]+)?(\/page\/\d+)?\/?$/.test(path);
