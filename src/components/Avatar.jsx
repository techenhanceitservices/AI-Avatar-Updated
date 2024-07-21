import "./Avatar.css";
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";
import { createAvatarSynthesizer, createWebRTCConnection } from "./Utility";
import { avatarAppConfig } from "./config";
import { useState, useRef } from "react";
import axios from "axios";

export const Avatar = () => {
    const [avatarSynthesizer, setAvatarSynthesizer] = useState(null);
    const myAvatarVideoEleRef = useRef();
    const myAvatarAudioEleRef = useRef();
    const [mySpeechText, setMySpeechText] = useState("");
    const [isListening, setIsListening] = useState(false);
    const [chatHistory, setChatHistory] = useState([]);
    const [sessionActive, setSessionActive] = useState(false);
    const recognitionRef = useRef(null);

    const iceUrl = avatarAppConfig.iceUrl;
    const iceUsername = avatarAppConfig.iceUsername;
    const iceCredential = avatarAppConfig.iceCredential;

    const handleSpeechText = (event) => {
        setMySpeechText(event.target.value);
    };

    const handleOnTrack = (event) => {
        if (event.track.kind === 'video') {
            const mediaPlayer = myAvatarVideoEleRef.current;
            mediaPlayer.id = event.track.kind;
            mediaPlayer.srcObject = event.streams[0];
            mediaPlayer.autoplay = true;
            mediaPlayer.playsInline = true;
        } else if (event.track.kind === 'audio') {
            const audioPlayer = myAvatarAudioEleRef.current;
            audioPlayer.srcObject = event.streams[0];
            audioPlayer.autoplay = true;
            audioPlayer.playsInline = true;
            audioPlayer.muted = false;
        }
    };

    const stopSession = () => {
        if (avatarSynthesizer) {
            try {
                avatarSynthesizer.stopSpeakingAsync().then(() => {
                    console.log("[" + (new Date()).toISOString() + "] Stop speaking request sent.");
                    avatarSynthesizer.close();
                }).catch((error) => {
                    console.error("Error stopping session: ", error);
                });
            } catch (e) {
                console.error("Error stopping session: ", e);
            }
        }
        setSessionActive(false);
        setChatHistory([]);
    };

    const handleSubmit = (event) => {
        event.preventDefault();
        if (sessionActive) {
            sendMessageToBackend(mySpeechText);
        } else {
            console.log("Session is not active.");
        }
    };

    const sendMessageToBackend = (message) => {
        const messagePayload = {
            messages: [
                {
                    role: "user",
                    content: message
                }
            ]
        };

        axios.post('http://localhost:3000/getAssistantResponse/chats', messagePayload)
            .then(response => {
                console.log('Backend response:', response); // Logs the full response for debugging

                const reply = response.data.response; // Adjust this based on your backend response structure

                if (typeof reply === 'string' && reply.trim() !== '') {
                    if (reply.includes("Aadhaar card number") || reply.includes("OTP")) {
                        setMySpeechText("");
                    }
                    updateChatHistory(message, reply);
                    speakText(reply);
                } else {
                    console.warn("Reply is not a string or is undefined:", reply);
                    updateChatHistory(message, "Sorry, I didn't understand that.");
                }
            })
            .catch(error => {
                console.error("Error sending message to backend: ", error);
                updateChatHistory(message, "There was an error communicating with the backend.");
            });
    };

    const updateChatHistory = (userMessage, reply) => {
        setChatHistory(prevHistory => [...prevHistory, { userMessage, reply }]);
    };

    const speakText = (textToSpeak) => {
        const audioPlayer = myAvatarAudioEleRef.current;
        audioPlayer.muted = false;

        if (avatarSynthesizer) {
            avatarSynthesizer.speakTextAsync(textToSpeak).then(
                (result) => {
                    if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                        console.log("Speech and avatar synthesized to video stream.");
                    } else {
                        console.log("Unable to speak. Result ID: " + result.resultId);
                        if (result.reason === SpeechSDK.ResultReason.Canceled) {
                            let cancellationDetails = SpeechSDK.CancellationDetails.fromResult(result);
                            console.log(cancellationDetails.reason);
                            if (cancellationDetails.reason === SpeechSDK.CancellationReason.Error) {
                                console.log(cancellationDetails.errorDetails);
                            }
                        }
                    }
                }).catch((error) => {
                console.error("Error speaking text: ", error);
                avatarSynthesizer.close();
            });

            setMySpeechText("");
        } else {
            console.error("Avatar synthesizer is not initialized.");
        }
    };

    const startSession = () => {
        console.log("Starting WebRTC session...");

        let peerConnection = createWebRTCConnection(iceUrl, iceUsername, iceCredential);
        peerConnection.ontrack = handleOnTrack;
        peerConnection.addTransceiver('video', { direction: 'sendrecv' });
        peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

        console.log("WebRTC connection created.");

        let synthesizer = createAvatarSynthesizer();
        setAvatarSynthesizer(synthesizer);

        peerConnection.oniceconnectionstatechange = e => {
            console.log("WebRTC status: " + peerConnection.iceConnectionState);

            if (peerConnection.iceConnectionState === 'connected') {
                console.log("Connected to Azure Avatar service");
            } else if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
                console.log("Azure Avatar service Disconnected");
            }
        };

        synthesizer.startAvatarAsync(peerConnection).then((r) => {
            console.log("[" + (new Date()).toISOString() + "] Avatar started.");
            setSessionActive(true);
        }).catch(
            (error) => {
                console.error("[" + (new Date()).toISOString() + "] Avatar failed to start. Error: " + error);
            }
        );
    };

    const startListening = () => {
        if (!recognitionRef.current) {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SpeechRecognition) {
                alert("Speech recognition is not supported in this browser.");
                return;
            }

            recognitionRef.current = new SpeechRecognition();
            recognitionRef.current.lang = "en-US";
            recognitionRef.current.interimResults = false;
            recognitionRef.current.continuous = false;

            recognitionRef.current.onresult = (event) => {
                const transcript = event.results[0][0].transcript;
                console.log("Transcript:", transcript);
                sendMessageToBackend(transcript);
            };

            recognitionRef.current.onerror = (event) => {
                console.error("Speech recognition error:", event.error);
            };

            recognitionRef.current.onend = () => {
                setIsListening(false);
                console.log("Speech recognition ended.");
            };
        }

        if (isListening) {
            recognitionRef.current.stop();
        } else {
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    return (
        <div className="avatar-container">
            <div className="header">
                <h1>Techenhance AI Assistant Avatar</h1>
            </div>
            <div className="content">
                <div className="video-section">
                    <video ref={myAvatarVideoEleRef} className="avatar-video" autoPlay></video>
                    <audio ref={myAvatarAudioEleRef} className="avatar-audio" autoPlay></audio>
                </div>
                <div className="chat-section">
                    <div className="chatHistory">
                        <h3>Chat History</h3>
                        <ul>
                            {chatHistory.map((entry, index) => (
                                <li key={index}>
                                    <strong>User:</strong> {entry.userMessage}
                                    <br />
                                    <strong>Avatar:</strong> {entry.reply}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div className="chatbox">
                        <form onSubmit={handleSubmit}>
                            <textarea
                                value={mySpeechText}
                                onChange={handleSpeechText}
                                placeholder="Type your message here..."
                            />
                            <button 
                                type="submit" 
                                className="chatbox-btn send"
                            >
                                Send
                            </button>
                        </form>
                        <button 
                            className={`restart-btn start ${sessionActive ? "disabled" : ""}`} 
                            onClick={startSession} 
                            disabled={sessionActive}
                        >
                            Start Session
                        </button>
                        <button 
                            className={`restart-btn stop ${!sessionActive ? "disabled" : ""}`} 
                            onClick={stopSession}
                            disabled={!sessionActive}
                        >
                            Stop Session
                        </button>
                        <button 
                            className={`restart-btn listening ${isListening ? "disabled" : ""}`} 
                            onClick={startListening}
                        >
                            {isListening ? "Stop Listening" : "Start Listening"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
