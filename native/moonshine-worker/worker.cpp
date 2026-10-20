// Isolated Windows x64 adapter for Moonshine Voice 0.1.5, ABI 3.0.0.
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cstring>
#include <cmath>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include "moonshine-c-api.h"

static_assert(sizeof(transcript_line_t) == 88, "Pinned x64 transcript ABI");
static_assert(sizeof(speaker_span_t) == 40, "Pinned x64 speaker ABI");
static std::string quote(const char* text) {
    if (!text) return "\"\"";
    std::string out = "\"";
    for (const unsigned char* p = reinterpret_cast<const unsigned char*>(text); *p; ++p) {
        if (out.size() > 60000) throw std::runtime_error("oversized transcript");
        if (*p == '"' || *p == '\\') { out += '\\'; out += *p; }
        else if (*p < 32) { char hex[7]; sprintf_s(hex,"\\u%04x",*p); out += hex; }
        else out += *p;
    }
    return out + '"';
}
static std::string utf8(const wchar_t* text) {
    int n = WideCharToMultiByte(CP_UTF8,0,text,-1,nullptr,0,nullptr,nullptr);
    std::string out(n,'\0'); WideCharToMultiByte(CP_UTF8,0,text,-1,out.data(),n,nullptr,nullptr); out.pop_back(); return out;
}
static void emit(const std::string& line) { if (line.size() > 262144) throw std::runtime_error("oversized event"); std::cout << line << '\n' << std::flush; }
static bool read(void* target, size_t count) { return fread(target,1,count,stdin) == count; }
int wmain(int argc, wchar_t** argv) {
    _setmode(_fileno(stdin), _O_BINARY);
    try {
        wchar_t exe[MAX_PATH]; GetModuleFileNameW(nullptr,exe,MAX_PATH);
        std::wstring path(exe); path.resize(path.find_last_of(L"\\/")+1); path += L"moonshine.dll";
        HMODULE dll = LoadLibraryExW(path.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
        if (!dll) throw std::runtime_error("native runtime unavailable");
        #define BIND(name) auto name = reinterpret_cast<decltype(&::name)>(GetProcAddress(dll,#name)); if (!name) throw std::runtime_error("runtime ABI unavailable")
        BIND(moonshine_get_version); BIND(moonshine_free_buffer);
        BIND(moonshine_get_stt_dependencies); BIND(moonshine_get_diarization_dependencies);
        BIND(moonshine_load_transcriber_from_files); BIND(moonshine_free_transcriber);
        BIND(moonshine_create_stream); BIND(moonshine_free_stream); BIND(moonshine_start_stream);
        BIND(moonshine_stop_stream); BIND(moonshine_transcribe_add_audio_to_stream); BIND(moonshine_transcribe_stream);
        const auto version = moonshine_get_version();
        if (version / 10000 != MOONSHINE_HEADER_VERSION / 10000) throw std::runtime_error("unsupported runtime version");
        if (argc == 3 && std::wstring(argv[1]) == L"--manifest") {
            std::string arch = utf8(argv[2]); moonshine_option_t options[] = {{"model_arch",arch.c_str()},{"word_timestamps","true"}};
            char* speech = nullptr; char* speakers = nullptr;
            if (moonshine_get_stt_dependencies("en",options,2,&speech) || moonshine_get_diarization_dependencies(&speakers)) throw std::runtime_error("asset catalog failed");
            std::string result = "{\"speech\":" + std::string(speech) + ",\"diarization\":" + std::string(speakers) + "}";
            moonshine_free_buffer(speech); moonshine_free_buffer(speakers); emit(result); return 0;
        }
        emit("{\"type\":\"hello\",\"protocol\":1,\"header\":30000,\"runtime\":"+std::to_string(version)+"}");
        if (argc == 2 && std::wstring(argv[1]) == L"--check") return 0;
        if (argc != 4) throw std::runtime_error("invalid worker configuration");
        std::string model = utf8(argv[1]), diarization = utf8(argv[2]);
        int arch = std::stoi(utf8(argv[3])); if (arch != 4 && arch != 5) throw std::runtime_error("unsupported architecture");
        moonshine_option_t options[] = {{"identify_speakers","true"},{"word_timestamps","true"},{"diarization_model_dir",diarization.c_str()}};
        int transcriber = moonshine_load_transcriber_from_files(model.c_str(),arch,options,3,MOONSHINE_HEADER_VERSION);
        if (transcriber < 0) throw std::runtime_error("speech model could not load");
        int stream = moonshine_create_stream(transcriber,0);
        if (stream < 0 || moonshine_start_stream(transcriber,stream)) { moonshine_free_transcriber(transcriber); throw std::runtime_error("speech stream failed"); }
        emit("{\"type\":\"ready\"}");
        uint64_t expected = 0;
        for (;;) {
            uint32_t length = 0; if (!read(&length,4)) throw std::runtime_error("input interrupted");
            if (length < 8 || length > 32008 || length % 2) throw std::runtime_error("invalid PCM frame");
            uint64_t offset = 0; if (!read(&offset,8) || offset != expected) throw std::runtime_error("invalid PCM offset");
            std::vector<int16_t> pcm((length-8)/2); if (!pcm.empty() && !read(pcm.data(),pcm.size()*2)) throw std::runtime_error("incomplete PCM frame");
            bool final = pcm.empty();
            if (final) { if (moonshine_stop_stream(transcriber,stream)) throw std::runtime_error("stream finalization failed"); }
            else {
                std::vector<float> audio(pcm.size()); for (size_t i=0;i<pcm.size();++i) audio[i]=pcm[i]/32768.0f;
                if (moonshine_transcribe_add_audio_to_stream(transcriber,stream,audio.data(),audio.size(),16000,0)) throw std::runtime_error("speech input failed");
                expected += pcm.size();
            }
            transcript_t* transcript = nullptr;
            if (moonshine_transcribe_stream(transcriber,stream,0,&transcript) || !transcript || transcript->line_count > 100000) throw std::runtime_error("transcription failed");
            // Copy/serialize every changed line before the next native call invalidates it.
            for (uint64_t i=0;i<transcript->line_count;++i) {
                const auto& line = transcript->lines[i];
                if (!line.is_updated && !line.is_new && !line.has_text_changed && !line.have_speakers_changed && !final) continue;
                if (!std::isfinite(line.start_time) || !std::isfinite(line.duration) || line.speaker_span_count > 1000 || line.word_count > 10000) throw std::runtime_error("invalid native transcript");
                std::ostringstream out; out.precision(9);
                out << "{\"type\":\"line\",\"line\":\"" << line.id << "\",\"complete\":" << (line.is_complete ? "true":"false") << ",\"start\":" << line.start_time << ",\"end\":" << line.start_time+line.duration << ",\"text\":" << quote(line.text) << ",\"spans\":[";
                for (uint64_t j=0;j<line.speaker_span_count;++j) { const auto& s = line.speaker_spans[j]; if(j) out << ',';
                    out << "{\"speaker\":\"" << s.speaker_index << "\",\"start\":" << s.start_time << ",\"end\":" << s.start_time+s.duration << ",\"textStart\":" << s.start_char << ",\"textEnd\":" << s.end_char << '}'; }
                out << "],\"words\":[";
                for (uint64_t j=0;j<line.word_count;++j) { const auto& w = line.words[j]; if(j) out << ','; out << "{\"text\":" << quote(w.text) << ",\"start\":" << w.start << ",\"end\":" << w.end;
                    if(std::isfinite(w.confidence) && w.confidence >= 0 && w.confidence <= 1) out << ",\"confidence\":" << w.confidence; out << '}'; }
                out << "]}"; emit(out.str());
            }
            emit("{\"type\":\"ack\",\"position\":"+std::to_string(expected)+",\"final\":"+(final ? "true":"false")+"}");
            if (final) break;
        }
        moonshine_free_stream(transcriber,stream); moonshine_free_transcriber(transcriber); FreeLibrary(dll); return 0;
    } catch (const std::exception&) {
        // Diagnostics deliberately contain no transcript text or file paths.
        std::cerr << "Moonshine worker failed; recording remains in Scribly.\n";
        return 1;
    }
}

