---
type: dashboard
tags: [dashboards]
created: 2026-03-03
updated: 2026-03-03
---

# Media Queues Dashboard

## Read It Later Inbox
```dataview
TABLE status, source, updated
FROM "00 Inbox"
WHERE type = "read-it-later"
SORT updated desc
```

## Reading Queue
```dataview
TABLE status, priority, source, updated
FROM "01 Notes"
WHERE type = "reading"
SORT status asc, updated desc
```

## Watch Queue
```dataview
TABLE status, platform, source, updated
FROM "01 Notes"
WHERE type = "watch"
SORT status asc, updated desc
```
