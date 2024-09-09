# spotify-dl (Spotify Downloader for Node.js)

- Inspired by [spotify-downloader](https://github.com/MattJaccino/spotify-downloader)
- Uses [SpotifyDown](https://spotifydown.com/)'s API
- Supports downloading of Albums and Playlists

**Requires**: `tsx` to be installed globally (`npm i -g tsx`)

### Basic Usage

**Get help**

```sh
tsx index.ts -h
```

**Download album / playlist from link**

```sh
tsx index.ts "https://open.spotify.com/album/6kxY4y9rGrWpnhofahze9h?si=uhqoQVoSQkKKz5nBP_6ozg"
```

**Using custom download path (must be absolute path!)**

```sh
tsx index.ts "https://open.spotify.com/album/6kxY4y9rGrWpnhofahze9h?si=uhqoQVoSQkKKz5nBP_6ozg" -p "/path/to/folder"
```
