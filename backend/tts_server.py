# backend/tts_server.py
import asyncio
import base64
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
import edge_tts

VOICE = "ru-RU-SvetlanaNeural"  # Лучший русский голос

class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/synthesize':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            text = data.get('text', '')
            
            print(f"🎤 Synthesizing: {text[:50]}...")
            
            async def synthesize():
                communicate = edge_tts.Communicate(text, VOICE)
                audio_data = b""
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_data += chunk["data"]
                return audio_data
            
            audio_data = asyncio.run(synthesize())
            audio_base64 = base64.b64encode(audio_data).decode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            response = json.dumps({
                'success': True,
                'audioData': audio_base64,
                'text': text
            })
            self.wfile.write(response.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            response = json.dumps({'status': 'running', 'voice': VOICE})
            self.wfile.write(response.encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == '__main__':
    port = 5001
    server = HTTPServer(('localhost', port), TTSHandler)
    print(f"✅ TTS Server running on port {port}")
    print(f"🎤 Voice: {VOICE}")
    server.serve_forever()