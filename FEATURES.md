# zig-zag.fm feature inventory (logged in, 13 Nov)

Source: DOM of the logged-in app. Screens not captured yet (pane too narrow).

## Layout
- Left sidebar (collapsible, resizable sections): nav + islands + profile.
- Center: full-screen deck.gl tile map. Labels float over tile clusters (genres, places).
- Right sidebar (resizable, 330px): player + item details.
- Bottom bar (resizable rows): filters + transport controls.
- Black background, dark panels, thin borders. Fonts: Dico (serif titles), PixelOperator (pixel text), IconBitOne (pixel icons), Roboto (body).

## Left sidebar
- Search
- Gems (favorites)
- Boat parties (shared group sessions)
- Cocktail (weekly pick)
- Starfish
- Messages (unread count)
- Supporters
- Islands: Create island, All islands, my islands list
- Profile: name, "N days at sea", "N discovered", "N collected"
- Settings, Webshop, Notifications (alt+T)

## Map
- Each tile = one item, colored by cluster. Clusters = islands/genres with floating labels.
- Pan/zoom. URL encodes position + selected item: `/<x>~<y>/track~<id>`.
- "Exploration map": shows where you've been (discovered tiles).

## Right panel (selected item)
- Media player (YouTube embed).
- Gem button with count, "add to island", next arrow.
- Row of icon actions (6+ icons, "more" menu).
- "Gemmed by" (users), "In islands" (island chips), album/metadata.
- Source credits: Discogs, AcousticBrainz, YouTube.

## Bottom bar
- Filters: key, BPM (range + tap tempo), format, landscape (search), year range, places, genres. "less filters", "Saved filters".
- Transport: Previous, Explore, Next (navigate), Play, position, Mute, Volume.
- "sofa mode" (lean-back autoplay).

## Social
- Gemmed sailors list, invite a friend, messages, boat parties.

## Mapping to Cala version
| zig-zag | Startup map |
|---|---|
| Track | Startup |
| Genre/place clusters | Sector / country islands |
| Player | Startup card: pitch, logo, website preview |
| key / BPM / format / year / places / genres filters | stage / round size / business model / founded year / country / sector |
| Gem | Watchlist |
| Island (user-made) | Investor list / thesis collection |
| Gemmed by | Investors who backed it (Cala) |
| In islands | Sectors + lists it belongs to |
| Explore / Next / sofa mode | Guided tour of startups matching a thesis |
| Exploration map | Coverage: startups already reviewed |
| Boat parties / messages | Out of scope for 36h |
