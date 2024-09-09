#!/usr/bin/env tsx

import axios from "axios";
import chalk from "chalk";
import { MultiBar } from "cli-progress";
import fs from "fs-extra";
import NodeID3, { Tags } from "node-id3";
import os from "os";
import PQueue from "p-queue";
import path from "path";
import sanitizeFilename from "sanitize-filename";
import invariant from "tiny-invariant";
import { URL } from "url";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const queue = new PQueue({ concurrency: 25 });

const mulbar = new MultiBar({
  format:
    "{bar} | {percentage}% | {value}/{total} | Successful: {success} | Failures: {failure}",
  barCompleteChar: "\u2588",
  barIncompleteChar: "\u2591",
  hideCursor: true,

  // only the bars will be cleared, not the logged content
  clearOnComplete: true,
  stopOnComplete: true,

  // important! redraw everything to avoid "empty" completed bars
  forceRedraw: true,
});

// Reusing the function to get Spotify Access Token
let accessToken: string | null = null;

async function getSpotifyAccessToken() {
  if (accessToken) {
    return accessToken;
  }

  try {
    const response = await axios.get(
      "https://open.spotify.com/get_access_token"
    );
    accessToken = response.data.accessToken;
    return accessToken;
  } catch (error) {
    console.error("Error fetching Spotify access token:", error);
    throw new Error("Failed to get access token");
  }
}

type SpotifyTrack = {
  id: string;
  name: string;
  artist: string;
};

type SpotifyResource = {
  id: string;
  tracks: SpotifyTrack[];
} & (
  | { type: "album"; title: string; artist: string }
  | { type: "playlist"; name: string; owner: string }
);

const getArtistFromArtists = (artists: Record<string, any>[]) =>
  artists.map((artist) => artist.name).join(", ");

function getTracks(items: Record<string, any>[]) {
  return items.map(({ id, name, artists, track }) =>
    id
      ? { id, name, artist: getArtistFromArtists(artists) }
      : {
          id: track.id,
          name: track.name,
          artist: getArtistFromArtists(track.artists),
        }
  );
}

const getTrackName = (track: SpotifyTrack) => `${track.name} - ${track.artist}`;

// Function to get album or playlist info
async function getSpotifyResource(
  type: SpotifyResource["type"],
  id: string
): Promise<SpotifyResource> {
  try {
    invariant(
      ["album", "playlist"].includes(type),
      `Unexpected type '${type}'`
    );

    const token = await getSpotifyAccessToken();
    const { data } = await axios.get(
      `https://api.spotify.com/v1/${type}s/${id}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const tracks = getTracks(data.tracks.items);
    let next = data.tracks.next;
    while (next) {
      const { data } = await axios.get(next, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      tracks.push(...getTracks(data.items));
      next = data.next;
    }

    if (type === "album") {
      return {
        type: "album",
        id: data.id,
        title: data.name,
        artist: getArtistFromArtists(data.artists),
        tracks,
      };
    }
    return {
      type: "playlist",
      id: data.id,
      name: data.name,
      owner: data.owner.display_name,
      tracks,
    };
  } catch (error) {
    console.error(`Error fetching Spotify ${type} info:`, error);
    throw new Error(`Failed to fetch ${type} info`);
  }
}

// Function to parse the Spotify URL and extract the type (album/playlist) and ID
function parseSpotifyUrl(urlString: string): {
  type: "album" | "playlist";
  id: string;
} {
  const url = new URL(urlString);
  if (!url.hostname.includes("spotify.com")) {
    throw new Error("Invalid domain. Only Spotify URLs are supported.");
  }
  const pathParts = url.pathname.split("/");
  const type = pathParts[1] as "album" | "playlist";
  const id = pathParts[2];
  if ((type === "album" || type === "playlist") && id) {
    return { type, id };
  } else {
    throw new Error(
      "Invalid Spotify URL. Must be a valid album or playlist URL."
    );
  }
}

// Function to determine the default downloads folder based on OS
function getDefaultDownloadPath(): string {
  const platform = os.platform();
  const homeDir = os.homedir();

  if (platform === "win32") {
    return path.join(homeDir, "Downloads");
  } else if (platform === "darwin") {
    return path.join(homeDir, "Downloads");
  } else {
    return path.join(homeDir, "Downloads");
  }
}

async function downloadTrack(
  track: SpotifyTrack,
  saveTo: string,
  index?: number
) {
  try {
    // Send the API request
    const response = await axios.get(
      `https://api.spotifydown.com/download/${track.id}`,
      {
        headers: {
          Host: "api.spotifydown.com",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
          Accept: "*/*",
          "Accept-Language": "en-US,en;q=0.5",
          "Accept-Encoding": "gzip",
          Referer: "https://spotifydown.com/",
          Origin: "https://spotifydown.com",
          DNT: "1",
          Connection: "keep-alive",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-site",
          "Sec-GPC": "1",
          TE: "trailers",
        },
      }
    );

    if (response.data.success && response.data.metadata) {
      const { metadata, link } = response.data;
      const { title, artists, cover } = metadata;

      // Define the filename based on the title and artist
      const filename = sanitizeFilename(`${getTrackName(track)}.mp3`);

      // Download the MP3 file
      const mp3Response = await axios.get(link, {
        responseType: "arraybuffer",
      });
      const mp3Buffer = Buffer.from(mp3Response.data);

      // Download the album cover image
      const coverResponse = await axios.get(cover, {
        responseType: "arraybuffer",
      });
      const coverBuffer = Buffer.from(coverResponse.data);

      // Save the MP3 file to disk
      const filePath = `${saveTo}/${filename}`;
      await fs.writeFile(filePath, mp3Buffer);

      // Embed album cover in the MP3 file
      const tags: Tags = {
        title,
        artist: artists,
        album: metadata.album,
        image: {
          mime: "image/jpeg",
          type: { id: 3 },
          imageBuffer: coverBuffer,
          description: "front cover",
        },
        ...(index !== undefined && { trackNumber: `${index + 1}` }),
      };
      const success = NodeID3.write(tags, filePath);

      if (!success) {
        throw new Error(`Failed to tag the MP3 file: ${filename}`);
      }
    } else {
      throw new Error("Failed to retrieve track metadata");
    }
  } catch (error) {
    throw new Error(
      axios.isAxiosError(error) ? error.message : (error as Error).message
    );
  }
}

// CLI Setup using yargs
yargs(hideBin(process.argv))
  .command<{ url: string; path?: string }>(
    "$0 <url>",
    "Download tracks from a Spotify album or playlist",
    (yargs) => {
      yargs
        .positional("url", {
          describe: "Spotify album or playlist URL",
          type: "string",
          demandOption: true,
        })
        .option("path", {
          alias: "p",
          describe: "Custom folder path (absolute) for downloads",
          type: "string",
          default: getDefaultDownloadPath(),
        });
    },
    async (argv) => {
      const { url, path: customPath } = argv;
      try {
        const { type, id } = parseSpotifyUrl(url);
        // console.log(`Fetching data for ${type} with ID: ${id}`);

        const data = await getSpotifyResource(type, id);
        // console.log(`${type} info retrieved successfully!`);

        const subPath =
          data.type === "album"
            ? `albums/${sanitizeFilename(`${data.artist} - ${data.title}`)}`
            : `playlists/${sanitizeFilename(`${data.owner} - ${data.name}`)}`;
        const fullPath = path.resolve(`${customPath}/spotify-dl/${subPath}`);
        await fs.ensureDir(fullPath);
        console.log(`Saving files to: ${chalk.bold(chalk.blue(fullPath))}`);

        console.log(`Downloading Spotify resource:`);
        console.log(`  Type   : ${chalk.bold(chalk.blue(data.type))}`);
        console.log(`  Id     : ${chalk.bold(chalk.blue(data.id))}`);
        if (data.type === "album") {
          console.log(`  Title  : ${chalk.bold(chalk.blue(data.title))}`);
          console.log(`  Artist : ${chalk.bold(chalk.blue(data.artist))}`);
        } else {
          console.log(`  Name   : ${chalk.bold(chalk.blue(data.name))}`);
          console.log(`  Owner  : ${chalk.bold(chalk.blue(data.owner))}`);
        }
        console.log(`  Tracks : ${chalk.bold(chalk.blue(data.tracks.length))}`);
        const maxRetries = 5;
        const downloadStatus = {
          expectedCount: data.tracks.length,
          success: [] as SpotifyTrack[],
          failures: [] as SpotifyTrack[],
        };
        console.log("");
        const bar = mulbar.create(data.tracks.length, 0, {
          success: 0,
          failure: 0,
        });

        await queue.addAll(
          data.tracks.map((track, index) => async () => {
            const trackName = getTrackName(track);
            const logStr = `(#${track.id}) ${trackName}`;
            let attempt = 0;
            while (attempt < maxRetries) {
              try {
                await downloadTrack(track, fullPath, index);
                mulbar.log(chalk.green(`✓ ${logStr}\n`));
                downloadStatus.success.push(track);
                break; // Exit loop if successful
              } catch (error) {
                attempt++;
                // mulbar.log(
                //   chalk.red(
                //     `(${attempt}/${maxRetries}) Error downloading track #${
                //       track.id
                //     } "${trackName}": ${(error as Error).message}\n`
                //   )
                // );
                if (attempt === maxRetries) {
                  mulbar.log(chalk.red(`x ${logStr}\n`));
                  mulbar.log(
                    chalk.red(
                      `Max retries reached. Last error: ${
                        (error as Error).message
                      }\n`
                    )
                  );
                  downloadStatus.failures.push(track);
                } else {
                  // Optional: Exponential backoff or other delay strategies
                  await new Promise((res) => setTimeout(res, 1000));
                }
              } finally {
                const { expectedCount, success, failures } = downloadStatus;
                // console.log(
                //   `\r(${success.length}/${failures.length}/${expectedCount}) Downloading ...`
                // );
                bar.update(success.length + failures.length, {
                  success: success.length,
                  failure: failures.length,
                });

                if (bar.getProgress() === 1) {
                  mulbar.log(chalk.green("\n(Download Summary)\n"));
                  mulbar.log(chalk.green(`  Total Count: ${expectedCount}\n`));
                  mulbar.log(chalk.green(`  Successful : ${success.length}\n`));
                  mulbar.log(chalk.red(`  Failures   : ${failures.length}\n`));
                }
              }
            }
          })
        );
      } catch (error) {
        console.error("Error:", (error as Error).message);
      }
    }
  )
  .help().argv;
