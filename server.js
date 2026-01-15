const express = require("express");
const path = require("path");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

const API_KEY = "AIzaSyDYja8cfnDpqCY27CuCP23Nyr-S-r1aIpc";

function extractIdentifier(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);

    if (parts[0].startsWith("@")) return parts[0]; // @handle
    if (parts[0] === "channel") return parts[1];  // channel id

    return parts[0];
  } catch {
    return null;
  }
}

async function resolveChannelId(identifier) {
  // If already channelId
  if (identifier.startsWith("UC")) return identifier;

  const res = await axios.get("https://www.googleapis.com/youtube/v3/search", {
    params: {
      part: "snippet",
      q: identifier.replace("@", ""),
      type: "channel",
      maxResults: 1,
      key: API_KEY
    }
  });

  if (!res.data.items.length) throw new Error("Channel not found");

  return res.data.items[0].snippet.channelId;
}

async function getUploadsPlaylist(channelId) {
  const res = await axios.get("https://www.googleapis.com/youtube/v3/channels", {
    params: {
      part: "contentDetails",
      id: channelId,
      key: API_KEY
    }
  });

  return res.data.items[0].contentDetails.relatedPlaylists.uploads;
}

function isShort(duration) {
  // ISO 8601 format examples:
  // PT45S, PT1M30S, PT3M, PT2M10S
  const match = duration.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);

  const minutes = parseInt(match?.[1] || 0);
  const seconds = parseInt(match?.[2] || 0);

  const totalSeconds = minutes * 60 + seconds;

  // YouTube Shorts limit (current): up to 3 minutes
  return totalSeconds <= 180;
}


async function getAllVideos(playlistId) {
  let videos = [];
  let nextPageToken = null;

  do {
    const res = await axios.get("https://www.googleapis.com/youtube/v3/playlistItems", {
      params: {
        part: "snippet",
        playlistId,
        maxResults: 50,
        pageToken: nextPageToken,
        key: API_KEY
      }
    });

    videos.push(...res.data.items);
    nextPageToken = res.data.nextPageToken;
  } while (nextPageToken);

  const result = [];

  // process in batches of 50
  for (let i = 0; i < videos.length; i += 50) {
    const batch = videos.slice(i, i + 50);
    const ids = batch.map(v => v.snippet.resourceId.videoId).join(",");

    const details = await axios.get("https://www.googleapis.com/youtube/v3/videos", {
      params: {
        part: "status,contentDetails",
        id: ids,
        key: API_KEY
      }
    });

    const embeddableMap = {};
const durationMap = {};

details.data.items.forEach(v => {
  embeddableMap[v.id] = v.status.embeddable;
  durationMap[v.id] = v.contentDetails.duration;
});


    batch.forEach(v => {
      const id = v.snippet.resourceId.videoId;
      if (embeddableMap[id]) {
        const duration = durationMap[id];

result.push({
  id,
  title: v.snippet.title,
  publishedAt: v.snippet.publishedAt,
  type: isShort(duration) ? "short" : "video"
});

      }
    });
  }

  return result;
}



app.get("/api/videos", async (req, res) => {
  try {
    const url = req.query.url;
    const identifier = extractIdentifier(url);

    if (!identifier) throw new Error("Invalid URL");

    const channelId = await resolveChannelId(identifier);
    const playlistId = await getUploadsPlaylist(channelId);

    let videos = await getAllVideos(playlistId);

const type = req.query.type || "all";

if (type === "shorts") {
  videos = videos.filter(v => v.type === "short");
} else if (type === "videos") {
  videos = videos.filter(v => v.type === "video");
}

videos.sort((a, b) => new Date(a.publishedAt) - new Date(b.publishedAt));


    res.json(videos);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(3000, () => {
  console.log("Backend running at http://localhost:3000");
});

