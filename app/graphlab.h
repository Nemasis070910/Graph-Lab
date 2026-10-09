// graphlab.h — Graph Lab instrumentation header (spike v0.1)
//
// The runner compiles learner code with:  g++ -std=c++23 -include graphlab.h main.cpp
// Learner code stays completely ordinary (#include <bits/stdc++.h>, using namespace std;).
// After the standard headers are loaded, `vector`, `queue` and `stack` are redirected to
// traced versions that behave the same but write one JSON event per operation to the
// file named by $GL_TRACE (default: trace.jsonl). Normal stdout stays untouched.
#pragma once
#include <bits/stdc++.h>
#include <source_location>

namespace gl {

inline std::FILE* out() {
  static std::FILE* f = [] {
    const char* p = std::getenv("GL_TRACE");
    return std::fopen(p ? p : "trace.jsonl", "w");
  }();
  return f;
}

inline long& budget() { static long b = 20000; return b; }  // event cap

inline int id_of(const void* p) {
  static std::unordered_map<const void*, int> ids;
  static int next = 1;
  auto it = ids.find(p);
  if (it != ids.end()) return it->second;
  return ids[p] = next++;
}

template <class T> std::string val(const T& v) {
  if constexpr (std::is_same_v<T, bool>) return v ? "1" : "0";
  else if constexpr (std::is_arithmetic_v<T>) { std::ostringstream s; s << v; return s.str(); }
  else if constexpr (requires { v.first; v.second; })
    return "[" + val(v.first) + "," + val(v.second) + "]";
  else return "null";
}

inline void emit(const std::string& body, const std::source_location& l) {
  if (budget() <= 0) return;
  if (--budget() == 0) {
    std::fprintf(out(), "{\"e\":\"truncated\"}\n");
    std::fflush(out());
    return;
  }
  std::fprintf(out(), "{%s,\"line\":%u}\n", body.c_str(), (unsigned)l.line());
  std::fflush(out());
}

inline std::string q(const char* s) { return std::string("\"") + s + "\""; }

// ---------------- vector ----------------
template <class T> class tvector : public std::vector<T> {
  using base = std::vector<T>;
  void decl(const std::source_location& l) {
    emit("\"e\":\"decl\",\"id\":" + std::to_string(id_of(this)) + ",\"type\":\"vector\",\"n\":" +
             std::to_string(base::size()) + ",\"init\":" + (base::empty() ? std::string("null") : val(static_cast<T>(base::front()))),
         l);
  }

 public:
  // element reference that logs writes (arithmetic / bool elements only)
  struct ref {
    tvector* v; std::size_t i; std::source_location l;
    operator T() const { return static_cast<const base&>(*v)[i]; }
    ref& operator=(const T& x) {
      static_cast<base&>(*v)[i] = x;
      emit("\"e\":\"set\",\"id\":" + std::to_string(id_of(v)) + ",\"i\":" + std::to_string(i) + ",\"v\":" + val(x), l);
      return *this;
    }
    ref& operator=(const ref& o) { return *this = T(o); }
    ref& operator+=(const T& x) { return *this = T(*this) + x; }
    ref& operator-=(const T& x) { return *this = T(*this) - x; }
    ref& operator++() { return *this += T(1); }
    T operator++(int) { T old = *this; *this += T(1); return old; }
  };

  tvector(std::source_location l = std::source_location::current()) { decl(l); }
  explicit tvector(std::size_t n, std::source_location l = std::source_location::current()) : base(n) { decl(l); }
  tvector(std::size_t n, const T& x, std::source_location l = std::source_location::current()) : base(n, x) { decl(l); }
  tvector(std::initializer_list<T> il, std::source_location l = std::source_location::current()) : base(il) { decl(l); }
  tvector(const tvector& o) : base(o) {}

  void push_back(const T& x, std::source_location l = std::source_location::current()) {
    base::push_back(x);
    emit("\"e\":\"push_back\",\"id\":" + std::to_string(id_of(this)) + ",\"v\":" + val(x), l);
  }

  decltype(auto) operator[](std::size_t i, std::source_location l = std::source_location::current()) {
    if (i >= base::size()) {
      emit("\"e\":\"error\",\"kind\":\"index\",\"id\":" + std::to_string(id_of(this)) + ",\"i\":" +
               std::to_string(i) + ",\"size\":" + std::to_string(base::size()),
           l);
      std::fprintf(stderr, "Graph Lab: line %u reads index %zu, but the size is %zu (valid: 0..%zu)\n",
                   (unsigned)l.line(), i, base::size(), base::size() ? base::size() - 1 : 0);
      std::exit(3);
    }
    if constexpr (std::is_arithmetic_v<T>) return ref{this, i, l};
    else return (static_cast<base&>(*this)[i]);
  }
};

// ---------------- queue ----------------
template <class T> class tqueue : public std::queue<T> {
  using base = std::queue<T>;
 public:
  tqueue(std::source_location l = std::source_location::current()) {
    emit("\"e\":\"decl\",\"id\":" + std::to_string(id_of(this)) + ",\"type\":\"queue\"", l);
  }
  void push(const T& x, std::source_location l = std::source_location::current()) {
    base::push(x);
    emit("\"e\":\"push\",\"id\":" + std::to_string(id_of(this)) + ",\"v\":" + val(x), l);
  }
  void pop(std::source_location l = std::source_location::current()) {
    T x = base::front();
    base::pop();
    emit("\"e\":\"pop\",\"id\":" + std::to_string(id_of(this)) + ",\"v\":" + val(x), l);
  }
};

// ---------------- stack ----------------
template <class T> class tstack : public std::stack<T> {
  using base = std::stack<T>;
 public:
  tstack(std::source_location l = std::source_location::current()) {
    emit("\"e\":\"decl\",\"id\":" + std::to_string(id_of(this)) + ",\"type\":\"stack\"", l);
  }
  void push(const T& x, std::source_location l = std::source_location::current()) {
    base::push(x);
    emit("\"e\":\"push\",\"id\":" + std::to_string(id_of(this)) + ",\"v\":" + val(x), l);
  }
  void pop(std::source_location l = std::source_location::current()) {
    T x = base::top();
    base::pop();
    emit("\"e\":\"pop\",\"id\":" + std::to_string(id_of(this)) + ",\"v\":" + val(x), l);
  }
};

}  // namespace gl

// Redirect the names learners write. Standard headers are already included above,
// so the library itself is unaffected; only code after this point sees the traced types.
template <class T> using gl_vector = gl::tvector<T>;
template <class T> using gl_queue = gl::tqueue<T>;
template <class T> using gl_stack = gl::tstack<T>;
#define vector gl_vector
#define queue gl_queue
#define stack gl_stack
