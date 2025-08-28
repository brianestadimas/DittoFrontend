"use client";

import { LoadingSVG } from "@/components/button/LoadingSVG";
import { ChatMessageType } from "@/components/chat/ChatTile";
import { ColorPicker } from "@/components/colorPicker/ColorPicker";
import { AudioInputTile } from "@/components/config/AudioInputTile";
import { ConfigurationPanelItem } from "@/components/config/ConfigurationPanelItem";
import { NameValueRow } from "@/components/config/NameValueRow";
import { PlaygroundHeader } from "@/components/playground/PlaygroundHeader";
import {
  PlaygroundTab,
  PlaygroundTabbedTile,
  PlaygroundTile,
} from "@/components/playground/PlaygroundTile";
import { useConfig } from "@/hooks/useConfig";
import { TranscriptionTile } from "@/transcriptions/TranscriptionTile";
import {
  BarVisualizer,
  VideoTrack,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRoomInfo,
  useTracks,
  useVoiceAssistant,
  useRoomContext,
  useParticipantAttributes,
} from "@livekit/components-react";
import { ConnectionState, LocalParticipant, Track } from "livekit-client";
import type { TrackReference } from "@livekit/components-react";
import { QRCodeSVG } from "qrcode.react";
import { ReactNode, useCallback, useEffect, useMemo, useState, useRef } from "react";
import tailwindTheme from "../../lib/tailwindTheme.preval";
import { EditableNameValueRow } from "@/components/config/NameValueRow";
import { AttributesInspector } from "@/components/config/AttributesInspector";
import { RpcPanel } from "./RpcPanel";
import { ChatMessageInput } from "@/components/chat/ChatMessageInput";

export const API_URL = "";


type StatusResp = {
  loaded: boolean;
  room?: string | null;
};

export interface PlaygroundMeta {
  name: string;
  value: string;
}

export interface PlaygroundProps {
  logo?: ReactNode;
  themeColors: string[];
  onConnect: (connect: boolean, opts?: { token: string; url: string }) => void;
}

const headerHeight = 56;

export default function Playground({
  logo,
  themeColors,
  onConnect,
}: PlaygroundProps) {
  const { config, setUserSettings } = useConfig();
  const { name } = useRoomInfo();
  const [transcripts, setTranscripts] = useState<ChatMessageType[]>([]);
  const { localParticipant } = useLocalParticipant();

  const voiceAssistant = useVoiceAssistant();

  const roomState = useConnectionState();
  const tracks = useTracks();
  const room = useRoomContext();

  const [rpcMethod, setRpcMethod] = useState("");
  const [rpcPayload, setRpcPayload] = useState("");
  const [showRpc, setShowRpc] = useState(false);
  const [transcribeText, setTranscribeText] = useState("");

  const agentOptions = [
    {
      name: "Alice",
      desc: "Interview Assistant",
      image: "alice.png",
      input_image: "static/avatar.png",
      voice: "af_heart",
    },
    {
      name: "Elenora",
      desc: "Customer Service",
      image: "elenora.png",
      input_image: "static/idle.mp4",
      voice: "af_sky",
    },
    {
      name: "James",
      desc: "Coding Assistant",
      image: "james.png",
      input_image: "static/james.mp4",
      voice: "am_adam",
    },
  ];
  const [selectedAgent, setSelectedAgent] = useState(agentOptions[0]);

  const [serverLoaded, setServerLoaded] = useState(false);

  const checkLoaded = useCallback(async () => {
    try {
      const r = await fetch(API_URL + "/status");
      if (!r.ok) return;
      const s: StatusResp = await r.json();
      if (s.loaded) {
        setServerLoaded(true);
        setHasHeardAudio(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (roomState === ConnectionState.Connected && name) {
      fetch(API_URL + "/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: name,
          input_image: selectedAgent.input_image,
          voice: selectedAgent.voice,
          name: selectedAgent.name,
          desc: selectedAgent.desc,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(() => {
          checkLoaded();
        });
    }

    if (roomState === ConnectionState.Disconnected && name) {
      fetch(API_URL + "/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room: name }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then(() => {
          checkLoaded();
        });
    }
  }, [roomState, name]);

  const sendTranscription = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!(roomState === ConnectionState.Connected)) return;

      await fetch(API_URL + "/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room: config.settings.room_name || name,
          text: trimmed,
          voice: selectedAgent.voice,
        }),
      });
    },
    [config.settings.room_name, name],
  );

  useEffect(() => {
    if (roomState === ConnectionState.Connected) {
      localParticipant.setCameraEnabled(config.settings.inputs.camera);
      localParticipant.setMicrophoneEnabled(config.settings.inputs.mic);
    }
  }, [config, localParticipant, roomState]);

  const agentVideoTrack = tracks.find(
    (trackRef) =>
      trackRef.publication.kind === Track.Kind.Video &&
      trackRef.participant.isAgent,
  );

  const localTracks = tracks.filter(
    ({ participant }) => participant instanceof LocalParticipant,
  );
  const localCameraTrack = localTracks.find(
    ({ source }) => source === Track.Source.Camera,
  );
  const localScreenTrack = localTracks.find(
    ({ source }) => source === Track.Source.ScreenShare,
  );
  const localMicTrack = localTracks.find(
    ({ source }) => source === Track.Source.Microphone,
  );

  const onDataReceived = useCallback((msg: any) => {
    if (msg.topic === "transcription") {
      const decoded = JSON.parse(new TextDecoder("utf-8").decode(msg.payload));
      let timestamp = new Date().getTime();
      if ("timestamp" in decoded && decoded.timestamp > 0) {
        timestamp = decoded.timestamp;
      }
      setTranscripts((prev) => [
        ...prev,
        { name: "You", message: decoded.text, timestamp, isSelf: true },
      ]);
    } else if (msg.topic === "agent_audio_ready") {
      setHasHeardAudio(true);
      setServerLoaded(true);
    }
  }, []);

  const [hasHeardAudio, setHasHeardAudio] = useState(false);
  const videoWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (roomState !== ConnectionState.Connected) {
      setHasHeardAudio(false);
      checkLoaded();
    }
  }, [roomState]);

  useEffect(() => {
    checkLoaded();
  }, [checkLoaded]);

  useDataChannel(onDataReceived);

  const videoTileContent = useMemo(() => {
    const videoFitClassName = `object-${config.video_fit || "contain"}`;

    const disconnectedContent = (
      <div className="flex items-center justify-center text-gray-700 text-center w-full h-full">
        No agent video track. Connect to get started.
      </div>
    );

    const loadingContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center h-full w-full">
        <img src="/loading.gif" alt="Loading..." />
        Waiting for agent video track…
      </div>
    );

    const videoContent = (
      <div ref={videoWrapRef} className="absolute inset-0 w-full h-full">
        {agentVideoTrack && (
          <VideoTrack
            trackRef={agentVideoTrack}
            className={`absolute inset-0 ${videoFitClassName} object-position-center w-full h-full`}
          />
        )}
        {!(hasHeardAudio || serverLoaded) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-700 text-center bg-black">
            <img src="/loading.gif" alt="Loading..." />
            Waiting for agent voice…
          </div>
        )}
      </div>
    );

    let content = null;
    if (roomState === ConnectionState.Disconnected) {
      content = disconnectedContent;
    } else if (agentVideoTrack) {
      content = videoContent;
    } else {
      content = loadingContent;
    }

    return (
      <div className="flex flex-col w-full grow text-gray-950 bg-black rounded-sm border border-gray-800 relative">
        {content}
      </div>
    );
  }, [agentVideoTrack, config, roomState, hasHeardAudio, serverLoaded]);

  useEffect(() => {
    document.body.style.setProperty(
      "--lk-theme-color",
      // @ts-ignore
      tailwindTheme.colors[config.settings.theme_color]["500"],
    );
    document.body.style.setProperty(
      "--lk-drop-shadow",
      `var(--lk-theme-color) 0px 0px 18px`,
    );
  }, [config.settings.theme_color]);

  const audioTileContent = useMemo(() => {
    const disconnectedContent = (
      <div className="flex flex-col items-center justify-center gap-2 text-gray-700 text-center w-full">
        No agent audio track. Connect to get started.
      </div>
    );

    const waitingContent = (
      <div className="flex flex-col items-center gap-2 text-gray-700 text-center w-full">
        <LoadingSVG />
        Waiting for agent audio track…
      </div>
    );

    const visualizerContent = (
      <div
        className={`flex items-center justify-center w-full h-48 [--lk-va-bar-width:30px] [--lk-va-bar-gap:20px] [--lk-fg:var(--lk-theme-color)]`}
      >
        <BarVisualizer
          state={voiceAssistant.state}
          trackRef={voiceAssistant.audioTrack}
          barCount={5}
          options={{ minHeight: 20 }}
        />
      </div>
    );

    if (roomState === ConnectionState.Disconnected) {
      return disconnectedContent;
    }

    if (!voiceAssistant.audioTrack) {
      return waitingContent;
    }

    return visualizerContent;
  }, [
    voiceAssistant.audioTrack,
    config.settings.theme_color,
    roomState,
    voiceAssistant.state,
  ]);

  const chatTileContent = useMemo(() => {
    if (voiceAssistant.agent) {
      return (
        <TranscriptionTile
          agentAudioTrack={voiceAssistant.audioTrack}
          accentColor={config.settings.theme_color}
        />
      );
    }
    return <></>;
  }, [
    config.settings.theme_color,
    voiceAssistant.audioTrack,
    voiceAssistant.agent,
  ]);

  const handleRpcCall = useCallback(async () => {
    if (!voiceAssistant.agent || !room) {
      throw new Error("No agent or room available");
    }

    const response = await room.localParticipant.performRpc({
      destinationIdentity: voiceAssistant.agent.identity,
      method: rpcMethod,
      payload: rpcPayload,
    });
    return response;
  }, [room, rpcMethod, rpcPayload, voiceAssistant.agent]);

  const agentAttributes = useParticipantAttributes({
    participant: voiceAssistant.agent,
  });

  const settingsTileContent = useMemo(() => {
    return (
      <div className="flex flex-col h-full w-full items-start overflow-y-auto">
        <ConfigurationPanelItem title="Transcribe">
          <ChatMessageInput
            placeholder="Type text…"
            accentColor={config.settings.theme_color}
            height={56}
            onSend={sendTranscription}
          />
        </ConfigurationPanelItem>

        <ConfigurationPanelItem title="Room">
          <div className="flex flex-col gap-2">
            <EditableNameValueRow
              name="Room name"
              value={
                roomState === ConnectionState.Connected
                  ? name
                  : config.settings.room_name
              }
              valueColor={`${config.settings.theme_color}-500`}
              onValueChange={(value) => {
                const newSettings = { ...config.settings };
                newSettings.room_name = value;
                setUserSettings(newSettings);
              }}
              placeholder="Auto"
              editable={roomState !== ConnectionState.Connected}
            />
            <NameValueRow
              name="Status"
              value={
                roomState === ConnectionState.Connecting ? (
                  <LoadingSVG diameter={16} strokeWidth={2} />
                ) : (
                  roomState.charAt(0).toUpperCase() + roomState.slice(1)
                )
              }
              valueColor={
                roomState === ConnectionState.Connected
                  ? `${config.settings.theme_color}-500`
                  : "gray-500"
              }
            />
          </div>
        </ConfigurationPanelItem>

        <ConfigurationPanelItem title="Agent">
          <div className="flex flex-row flex-wrap gap-3 pt-2 justify-start">
            {agentOptions.map((agent, i) => (
              <div
                key={i}
                className={`avatar-option ${
                  selectedAgent.name === agent.name ? "selected" : ""
                }`}
                onClick={() => setSelectedAgent(agent)}
              >
                <img src={agent.image} className="avatar-img" />
                <strong>{agent.name}</strong>
                <br />
                <small>{agent.desc}</small>
              </div>
            ))}
          </div>
        </ConfigurationPanelItem>

        {roomState === ConnectionState.Connected && voiceAssistant.agent && (
          <RpcPanel
            config={config}
            rpcMethod={rpcMethod}
            rpcPayload={rpcPayload}
            setRpcMethod={setRpcMethod}
            setRpcPayload={setRpcPayload}
            handleRpcCall={handleRpcCall}
          />
        )}
        {localCameraTrack && (
          <ConfigurationPanelItem title="Camera" source={Track.Source.Camera}>
            <div className="relative">
              <VideoTrack
                className="rounded-sm border border-gray-800 opacity-70 w-full"
                trackRef={localCameraTrack}
              />
            </div>
          </ConfigurationPanelItem>
        )}
        {localMicTrack && (
          <ConfigurationPanelItem
            title="Microphone"
            source={Track.Source.Microphone}
          >
            <AudioInputTile trackRef={localMicTrack} />
          </ConfigurationPanelItem>
        )}
        {config.show_qr && (
          <div className="w-full">
            <ConfigurationPanelItem title="QR Code">
              <QRCodeSVG value={window.location.href} width="128" />
            </ConfigurationPanelItem>
          </div>
        )}
      </div>
    );
  }, [
    config.description,
    config.settings,
    config.show_qr,
    localParticipant,
    name,
    roomState,
    localCameraTrack,
    localScreenTrack,
    localMicTrack,
    themeColors,
    setUserSettings,
    voiceAssistant.agent,
    rpcMethod,
    rpcPayload,
    handleRpcCall,
    showRpc,
    setShowRpc,
    selectedAgent
  ]);

  let mobileTabs: PlaygroundTab[] = [];
  if (config.settings.outputs.video) {
    mobileTabs.push({
      title: "Video",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {videoTileContent}
        </PlaygroundTile>
      ),
    });
  }

  if (config.settings.outputs.audio) {
    mobileTabs.push({
      title: "Audio",
      content: (
        <PlaygroundTile
          className="w-full h-full grow"
          childrenClassName="justify-center"
        >
          {audioTileContent}
        </PlaygroundTile>
      ),
    });
  }

  mobileTabs.push({
    title: "Settings",
    content: (
      <PlaygroundTile
        padding={false}
        backgroundColor="gray-950"
        className="h-full w-full basis-1/4 items-start overflow-y-auto flex"
        childrenClassName="h-full grow items-start"
      >
        {settingsTileContent}
      </PlaygroundTile>
    ),
  });

  return (
    <>
      <PlaygroundHeader
        title={config.title}
        logo={logo}
        githubLink={config.github_link}
        height={headerHeight}
        accentColor={config.settings.theme_color}
        connectionState={roomState}
        onConnectClicked={() =>
          onConnect(roomState === ConnectionState.Disconnected)
        }
      />
      <div
        className={`flex gap-4 py-4 grow w-full selection:bg-${config.settings.theme_color}-900`}
        style={{ height: `calc(100% - ${headerHeight}px)` }}
      >
        <div className="flex flex-col grow basis-1/2 gap-4 h-full lg:hidden">
          <PlaygroundTabbedTile
            className="h-full"
            tabs={mobileTabs}
            initialTab={mobileTabs.length - 1}
          />
        </div>
        <div
          className={`flex-col grow basis-1/2 gap-4 h-full hidden lg:${
            !config.settings.outputs.audio && !config.settings.outputs.video
              ? "hidden"
              : "flex"
          }`}
        >
          {config.settings.outputs.video && (
            <PlaygroundTile
              title="Agent Video"
              className="w-full h-full grow"
              childrenClassName="justify-center"
            >
              {videoTileContent}
            </PlaygroundTile>
          )}
        </div>

        <PlaygroundTile
          padding={false}
          backgroundColor="gray-950"
          className="h-full w-full basis-1/4 items-start overflow-y-auto hidden max-w-[480px] lg:flex"
          childrenClassName="h-full grow items-start"
        >
          {settingsTileContent}
        </PlaygroundTile>
      </div>
    </>
  );
}
