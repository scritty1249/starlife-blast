# API Reference

## Base URL
The base path for all API requests is

`/api`

## Endpoints

### `GET /maps/manifest`
**Returns (JSON):**

A list of all available maps
| Key | Type |
| :-- | :-- |
| maps | array of [MapSelection](#object-mapselection) |

### `POST /lobby/new`
**Request Body Parameters (JSON):**

Game will start when `teamcount` is met or host initiates manually.
| Key | Type | Detail |
| :-- | :-- | :-- |
| mapid | [Snowflake](#string-snowflake) ||
| channelid | [Snowflake](#string-snowflake) | Discord channel the invite was sent to |
| teamsize | integer | greater than `0` |
| teamcount | integer | greater than `1` |
| player | [PlayerProfile](#object-playerprofile) | from the hosting player |

**Returns (JSON):**

An ID of the created lobby, or null if one could not be made.
| Key | Type |
| :-- | :-- |
| lobbyid | ?[Snowflake](#string-snowflake) |

### `POST /lobby/start`
Add a player to a waiting lobby.

**Request Body Parameters (JSON):**
| Key | Type | Detail |
| :-- | :-- | :-- |
| lobbyid | [Snowflake](#string-snowflake) |
| hostid | [Snowflake](#string-snowflake) | Discord user ID of the player that created the lobby |

> - If the records indicated by `hostid` and `lobbyid` do not match, this endpoint will return `403 Forbidden`. A side effect is that calling this endpoint on an invalid, already active, or closed lobby, will also return `403 Forbidden` 

**Returns (JSON):**

true if the lobby was started, and false otherwise.
| Key | Type |
| :-- | :-- |
| success | boolean |

### `POST /lobby/add`
Add a player to a waiting lobby.

**Request Body Parameters (JSON):**
| Key | Type | Detail |
| :-- | :-- | :-- |
| lobbyid | [Snowflake](#string-snowflake) |
| teamid | [Snowflake](#string-snowflake) |
| player | [PlayerProfile](#object-playerprofile) ||

**Returns (JSON):**

true if the lobby was joined, and false otherwise.
| Key | Type |
| :-- | :-- |
| success | boolean |

### `GET /lobby/info`
Get details of an ongoing lobby.

**Request Query Parameters:**
- `lobbyid` is the [Snowflake](#string-snowflake) ID of a waiting or active lobby
- `userid` is the [Snowflake](#string-snowflake) Discord ID of the requesting player. This parameter is optional

**Returns (JSON):**

The specified lobby's data, or null it does not exist.
| Key | Type | Detail |
| :-- | :-- | :-- |
| lobby | ?[Lobby](#object-lobby) ||
| ishost | boolean | true if provided `userid` parameter matches id of lobby host. false otherwise |
| websocket | [AuthorizedWebsocketPayload](#object-authorizedwebsocketpayload) | payload to connect to join phase websocket channel |

### `GET /lobby/auth`

**Request Query Parameters**
- `lobbyid` is the [Snowflake](#string-snowflake) ID of a waiting or active lobby
- `userid` is the [Snowflake](#string-snowflake) ID of the calling player.

> - If a corrosponding lobby to `lobbyid` cannot be found, this endpoint will return `404 Not Found`
> - If the player indicated by `playerid` is not in the corrosponding lobby, this endpoint will return `403 Forbidden`

**Returns (JSON):**

The signed endpoint to download the lobby's terrain data.

| Key | Type | Detail |
| :-- | :-- | :-- |
| terrain | [AuthorizedTerrainPayload](#object-authorizedterrainpayload) ||
| websocket | [AuthorizedWebsocketPayload](#object-authorizedwebsocketpayload) | payload to connect to round phase websocket channel |

### `POST /lobby/auth`
Stages a round update, and generates an presigned link to upload the lobby's terrain data. 

**Request Body Parameters (JSON):**
| Key | Type | Detail |
| :-- | :-- | :-- |
| lobbyid | [Snowflake](#string-snowflake) ||
| userid | [Snowflake](#string-snowflake) ||

**Returns (JSON):**
| Key | Type | Detail |
| :-- | :-- | :-- |
| token | [Token](#string-token) | a token to use with [`POST /lobby/round/update`](#post-lobbyroundupdate) |
| ttl | number | remaining seconds to commit the update |
| url | [URL](#string-url) | a link to upload a lobby's terrian [Polygon](#binary-stream-polygon) |

> - If `userid` does not corrospond to a play in the lobby, this endpoint will return `403 Forbidden`
> - If a call to [`POST /lobby/round/update`](#post-lobbyroundupdate) is not made within `ttl`, any terrain data uploaded to `url` will be discarded
> - If an update is made for a lobby that is still in the `Waiting` state, this endpoint will return `403 Forbidden`

### `POST /lobby/round/update`
Commits a staged round update. Updated players corrospond to players that are already in the lobby. Updates to players that do not already in the lobby are discarded.

**Request Body Parameters (JSON):**
| Key | Type | Detail |
| :-- | :-- | :-- |
| token | [Token](#string-token) | the token returned from [`POST /lobby/terrain/auth`](#post-lobbyterrainauth) |
| lobbyid | [Snowflake](#string-snowflake) ||
| ?players | [PlayerMap](#object-playermap) |  changed player instances in the lobby |

## Type Definitions

### *object* `PlayerInstance`
| Key | Type | Detail |
| :-- | :-- | :-- |
| ?position | [Vector](#array-vector) | player's current position |
| ?rotation | number | player's aim angle |
| ?orientation | number | player's body angle |
| ?power | number | 0-1 (inclusive) player's launch power |
| hitpoints | array of [HitAmount](#object-hitamount) | damage applied in descending order |
| data | [PlayerData](#object-playerdata) ||

### *object* `PlayerMap`
| Key | Type | Detail |
| :-- | :-- | :-- |
| [PlayerInstance](#object-playerinstance).[PlayerData](#object-playerdata).[PlayerProfile](#object-playerprofile).`userid` | [PlayerInstance](#object-playerinstance) | each instance is mapped to it's own ID |
| ... | ... | continuing for each player |

### *object* `Lobby`
| Key | Type | Detail |
| :-- | :-- | :-- |
| players | [PlayerMap](#object-playermap) ||
| state | integer ||
| teamsize | number ||
| teams | array of [Snowflake](#string-snowflake) | List of team ids |
| turnorder | array of [Snowflake](#string-snowflake) | Ordered list of player ids, dictating play order |
| turns | integer | Number of turns played in the lobby |
| channelid | [Snowflake](#string-snowflake) | Discord channel the invite was created in |

### *object* `PlayerData`
| Key | Type | Detail |
| :-- | :-- | :-- |
| model | string | visual model type |
| ammo | array of [AmmoType](#string-ammotype) ||
| team | [Snowflake](#string-snowflake) | player's affiliation |
| profile | [PlayerProfile](#object-playerprofile) ||

### *object* `PlayerProfile`
| Key | Type | Detail |
| :-- | :-- | :-- |
| userid | [Snowflake](#string-snowflake) ||
| name | string | display name within the Discord channel |
| avatar | [URL](#string-url) | link to the avatar within the Discord channel |
| ?fontFamily | string | font to render `name` with in-game |

### *object* `MapSelection`
| Key | Type | Detail |
| :-- | :-- | :-- |
| name | string ||
| src | [URL](#URL) | location of terrain data |
| thumb | [URL](#URL) | location of thumbnail image |

### *object* `HitAmount`
| Key | Type | Detail |
| :-- | :-- | :-- |
| type | string | hitpoint type |
| max | integer ||
| amount | integer | current hitpoints |
| regen | number ||
| reserve | number | `amount` cannot exceed this |
| increase | number | factor all increases to `amount` are applied by |
| decrease | number | factor all decreases to `amount` are applied by |

### *object* `AuthorizedTerrainPayload`
A presigned link to download a lobby's terrain data.
| Key | Type | Detail |
| :-- | :-- | :-- |
| url | [URL](#string-url) | a signed link to download a lobby's terrian [Polygon](#binary-stream-polygon) |
| ttl | number | seconds before the download link expires |
> - The blob downloaded from `url` will be a [Polygon](#binary-stream-polygon)

### *object* `AuthorizedWebsocketPayload`
Parameters to construct a Supabase client for Realtime (websocket) connection for a specific lobby.
| Key | Type | Detail |
| :-- | :-- | :-- |
| url | [URL](#string-url) ||
| key | string ||
| id | string | The channel id of the websocket for the associated lobby. |

### *binary stream* `Polygon`
Should be sent as a blob of `application/octet-stream` type.
| Byte | Type | Detail |
| :-- | :-- | :-- |
| 0-4 | uint32 | length `X` of following [PolygonMetadata](#object-polygonmetadata) |
| 4 to `X` | [PolygonMetadata](#object-polygonmetadata) ||
| `X` ( *`i`<sub>0</sub>* ) to `Y`<sub>0</sub> | [Path](#array-path) | polygon path |
| `i`<sub>`n`</sub> to `Y`<sub>`n`</sub> | [Path](#array-path) | `n` hole paths, if any. Depth-first order is recommended but not required |

### *object* `PolygonMetadata`
| Key | Type | Detail |
| :-- | :-- | :-- |
| o | uint32 | *index*. Starting byte offset of pathlength |
| p | number | *pathlength*. Byte length `Y` of [Path](#array-path) for corrosponding [Polygon](#object-polygon) |
| h | array of [PolygonMetadata](#object-polygonmetadata) | *holes*. For sanity, backend will impose a recursion depth limit of 3 |

### *array* `Vector`
| Index | Type | Detail |
| :-- | :-- | :-- |
| 0 | number | x |
| 1 | number | y |

### *array* `Path`
Contains the buffer of a `Float32Array` representing [Vectors](#array-vector). Should be sent as part of a blob.

### *string* `URL`
A link to a specified location or resource.

### *string* `AmmoType`
The unique name of an in-game Ammo type.

### *string* `Snowflake`
A unique 64 bit identifier. See [Discord's documentation](https://docs.discord.com/developers/reference#snowflakes) for more information on Snowflake IDs.

### *string* `Token`
A unique token generated for atomic operations.