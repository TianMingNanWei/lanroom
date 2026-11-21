import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { LogOut, Map as MapIcon, ScrollText, Shield, Users, DoorOpen } from "lucide-react";
import { api, can, setToken, token, type MapMember, type Role, type Room, type User } from "./api";
import { MapView } from "./MapView";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Page = "map" | "rooms" | "users" | "roles" | "logs" | "login";

function pageFromHash(): Page {
  const name = location.hash.replace("#/", "") as Page;
  return ["map", "rooms", "users", "roles", "logs", "login"].includes(name) ? name : "map";
}

function when(value: string) {
  return value.replace("T", " ").slice(0, 19);
}

type Session = "checking" | "in" | "out";

export function App() {
  const saved = token();
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(saved ? pageFromHash() : "login");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session>(saved ? "checking" : "out");

  useEffect(() => {
    const onHash = () => {
      setError("");
      setPage(pageFromHash());
    };
    window.addEventListener("hashchange", onHash);
    if (!token()) {
      setSession("out");
      return () => window.removeEventListener("hashchange", onHash);
    }
    api.me().then((next) => {
      setUser(next);
      setSession("in");
      if (pageFromHash() === "login") location.hash = "#/map";
    }).catch(() => {
      setUser(null);
      setSession("out");
      setPage("login");
    });
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (session === "checking") {
    return <div className="min-h-screen bg-background" />;
  }

  if (session === "out" || !user || page === "login") {
    return <Login onUser={(next) => { setUser(next); setSession("in"); }} />;
  }

  const links: { id: Page; label: string; code?: string; icon: typeof MapIcon }[] = [
    { id: "map", label: "全球地图", code: "map:read", icon: MapIcon },
    { id: "rooms", label: "房间", code: "room:read", icon: DoorOpen },
    { id: "users", label: "用户", code: "user:read", icon: Users },
    { id: "roles", label: "角色", code: "role:read", icon: Shield },
    { id: "logs", label: "登录记录", code: "user:read", icon: ScrollText },
  ];

  function logout() {
    void api.logout();
    setToken("");
    setUser(null);
    setSession("out");
    location.hash = "#/login";
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="px-4 py-5">
          <p className="text-xs font-medium tracking-[0.16em] text-primary">LANROOM</p>
          <p className="mt-1 text-sm font-medium">管理后台</p>
        </div>
        <nav className="grid gap-1 px-2">
          {links.filter((link) => !link.code || can(user, link.code)).map((link) => {
            const Icon = link.icon;
            return (
              <Button key={link.id} variant={page === link.id ? "secondary" : "ghost"} className="justify-start" asChild>
                <a href={`#/${link.id}`}>
                  <Icon />
                  {link.label}
                </a>
              </Button>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">{user.displayName || user.username}</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{user.role}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout}>
                <LogOut />
                退出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 p-6">
          {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
          {page === "map" && <MapPage user={user} />}
          {page === "rooms" && <RoomsPage user={user} onError={setError} />}
          {page === "users" && <UsersPage onError={setError} />}
          {page === "roles" && <RolesPage onError={setError} />}
          {page === "logs" && <LogsPage onError={setError} />}
        </main>
      </div>
    </div>
  );
}

function Login({ onUser }: { onUser: (user: User) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const body = await api.login(username, password);
      setToken(body.token);
      onUser(body.user);
      location.hash = "#/map";
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-primary">LANROOM</p>
            <h1 className="mt-1 text-2xl font-semibold">登录管理后台</h1>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="username">账号</Label>
            <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">密码</Label>
            <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          </div>
          <Button type="submit" className="w-full">登录</Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </form>
      </Card>
    </div>
  );
}

function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function MapPage({ user }: { user: User }) {
  const [room, setRoom] = useState("");
  const [rooms, setRooms] = useState<string[]>([]);
  const [members, setMembers] = useState<MapMember[]>([]);
  const [cities, setCities] = useState<{ country: string; city: string; lat: number; lon: number; count: number }[]>([]);
  const [countries, setCountries] = useState<{ country: string; count: number }[]>([]);
  const [selected, setSelected] = useState<MapMember | null>(null);
  const [logins, setLogins] = useState(false);
  const canReadLogs = can(user, "user:read");

  useEffect(() => {
    let stop = false;
    const load = () => {
      api.map(room).then((body) => {
        if (stop) return;
        setRooms(body.rooms);
        const showLogs = logins && canReadLogs;
        setMembers(showLogs ? body.logins.map((item) => ({
          room: "登录",
          owner: item.username,
          mac: item.result,
          virtualIp: "",
          source: item.ip,
          country: item.country,
          city: item.city,
          lat: item.lat,
          lon: item.lon,
        })) : body.members);
        setCities(showLogs ? [] : body.cities);
        setCountries(showLogs ? [] : body.countries);
      }).catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [room, logins, canReadLogs]);

  return (
    <>
      <PageHead title="全球地图">
        <Select value={room || "all"} onValueChange={(value) => setRoom(value === "all" ? "" : value)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="全部房间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部房间</SelectItem>
            {rooms.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
          </SelectContent>
        </Select>
        {canReadLogs && (
          <Button variant={logins ? "default" : "outline"} onClick={() => setLogins((value) => !value)}>
            {logins ? "成员位置" : "登录位置"}
          </Button>
        )}
      </PageHead>
      <MapView countries={countries} cities={cities} members={members} showLogins={false} onSelect={setSelected} />
      <Dialog open={selected != null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.room}</DialogTitle>
            <DialogDescription>在线位置来自房间成员的公网地址，不采集浏览器定位。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1 text-sm">
            {selected?.room === "登录" ? (
              <>
                <p>账号 {selected?.owner}</p>
                <p>结果 {selected?.mac}</p>
              </>
            ) : (
              <>
                <p>拥有者 {selected?.owner}</p>
                <p>MAC {selected?.mac}</p>
                <p>虚拟地址 {selected?.virtualIp || "—"}</p>
              </>
            )}
            <p>来源 {selected?.source}</p>
            <p>{selected?.city || "未定位"} {selected?.country}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoomsPage({ user, onError }: { user: User; onError: (value: string) => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [ticket, setTicket] = useState("");
  const [membersRoom, setMembersRoom] = useState<string | null>(null);
  const [members, setMembers] = useState<{ room: string; mac: string; virtualIp: string; source: string }[]>([]);

  async function load(query = q) {
    onError("");
    const body = await api.rooms(query);
    setRooms(body.items);
  }

  async function loadMembers(roomName: string) {
    onError("");
    const body = await api.members(roomName);
    setMembersRoom(roomName);
    setMembers(body.items.map((item) => ({ room: roomName, ...item })));
  }

  useEffect(() => { void load().catch((err) => onError(String(err))); }, []);

  return (
    <>
      <PageHead title="房间">
        <Input className="w-40" placeholder="搜索" value={q} onChange={(event) => setQ(event.target.value)} />
        <Button variant="outline" onClick={() => void load().catch((err) => onError(String(err)))}>查询</Button>
      </PageHead>
      {can(user, "room:write") && (
        <form className="mb-4 flex gap-2" onSubmit={(event) => {
          event.preventDefault();
          void api.createRoom(name).then(() => { setName(""); return load(""); }).catch((err) => onError(err instanceof Error ? err.message : "失败"));
        }}>
          <Input className="max-w-xs" placeholder="新房间名" value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit">创建</Button>
        </form>
      )}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>房间</TableHead>
              <TableHead>拥有者</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.name}>
                <TableCell>{room.name}</TableCell>
                <TableCell>{room.owner}</TableCell>
                <TableCell className="text-muted-foreground">{when(room.createdAt)}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => void loadMembers(room.name).catch((err) => onError(err instanceof Error ? err.message : String(err)))}>成员</Button>
                    {(room.mine || can(user, "room:manage")) && <Button variant="outline" size="sm" onClick={() => void api.ticket(room.name).then((body) => { onError(""); setTicket(body.token); }).catch((err) => onError(err instanceof Error ? err.message : String(err)))}>票据</Button>}
                    {(room.mine || can(user, "room:manage")) && <Button variant="destructive" size="sm" onClick={() => void api.closeRoom(room.name).then(() => load()).catch((err) => onError(err instanceof Error ? err.message : String(err)))}>关闭</Button>}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={ticket !== ""} onOpenChange={(open) => { if (!open) setTicket(""); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>加入票据</DialogTitle>
            <DialogDescription>12 小时内有效。桌面端登录后会自己领取。</DialogDescription>
          </DialogHeader>
          <Textarea readOnly value={ticket} className="min-h-24" />
          <DialogFooter>
            <Button onClick={() => void navigator.clipboard.writeText(ticket)}>复制</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={membersRoom !== null} onOpenChange={(open) => { if (!open) { setMembersRoom(null); setMembers([]); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>在线成员{membersRoom ? ` · ${membersRoom}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 text-sm">
            {members.length === 0 && <p className="text-muted-foreground">暂无在线成员</p>}
            {members.map((member) => (
              <div key={member.mac} className="flex items-center justify-between gap-3">
                <span>{member.mac} · {member.virtualIp} · {member.source}</span>
                {can(user, "member:kick") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => void api.kick(member.room, member.mac).then(() => loadMembers(member.room)).catch((err) => onError(err instanceof Error ? err.message : String(err)))}
                  >
                    移出
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function UsersPage({ onError }: { onError: (value: string) => void }) {
  const [items, setItems] = useState<User[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ username: "", password: "", display_name: "", role_key: "member" });

  function load() {
    return api.users(q).then((body) => setItems(body.items));
  }
  useEffect(() => { void load().catch((err) => onError(String(err))); }, []);

  return (
    <>
      <PageHead title="用户">
        <Input className="w-40" placeholder="搜索" value={q} onChange={(event) => setQ(event.target.value)} />
        <Button variant="outline" onClick={() => void load().catch((err) => onError(err instanceof Error ? err.message : String(err)))}>查询</Button>
        <Button onClick={() => setOpen(true)}>新建</Button>
      </PageHead>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead>显示名</TableHead>
              <TableHead>角色</TableHead>
              <TableHead>状态</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.username}</TableCell>
                <TableCell>{item.displayName}</TableCell>
                <TableCell>{item.role}</TableCell>
                <TableCell>
                  <Badge variant={item.isActive ? "secondary" : "destructive"}>{item.isActive ? "启用" : "停用"}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => void api.patchUser(item.id, { is_active: !item.isActive }).then(load).catch((err) => onError(err instanceof Error ? err.message : String(err)))}>
                    {item.isActive ? "停用" : "启用"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            void api.createUser(form).then(() => { setOpen(false); return load(); }).catch((err) => onError(err instanceof Error ? err.message : "失败"));
          }}>
            <DialogHeader>
              <DialogTitle>新建用户</DialogTitle>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="new-username">账号</Label>
              <Input id="new-username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-display">显示名</Label>
              <Input id="new-display" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-password">密码</Label>
              <Input id="new-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>角色</Label>
              <Select value={form.role_key} onValueChange={(value) => setForm({ ...form, role_key: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">成员</SelectItem>
                  <SelectItem value="operator">运维</SelectItem>
                  <SelectItem value="admin">管理员</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>取消</Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RolesPage({ onError }: { onError: (value: string) => void }) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [catalog, setCatalog] = useState<{ code: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Role | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  function load() {
    return Promise.all([api.roles(), api.permissions()]).then(([roleBody, permBody]) => {
      setRoles(roleBody.items);
      setCatalog(permBody.items);
    });
  }
  useEffect(() => { void load().catch((err) => onError(String(err))); }, []);

  return (
    <>
      <PageHead title="角色" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>角色</TableHead>
              <TableHead>权限</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.key}>
                <TableCell>
                  <div>{role.name}</div>
                  <div className="text-xs text-muted-foreground">{role.key}</div>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">{role.permissions.join("、")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => { setEditing(role); setPicked(role.permissions); }}>编辑</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Dialog open={editing != null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <form className="grid gap-4" onSubmit={(event) => {
            event.preventDefault();
            if (!editing) return;
            void api.saveRole(editing.key, editing.name, picked).then(() => { setEditing(null); return load(); }).catch((err) => onError(String(err)));
          }}>
            <DialogHeader>
              <DialogTitle>{editing?.name}</DialogTitle>
              <DialogDescription>从已有权限目录中勾选，不能新建权限代码。</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              {catalog.map((item) => (
                <Label key={item.code} className="flex items-center gap-2 font-normal">
                  <Checkbox
                    checked={picked.includes(item.code)}
                    onCheckedChange={(checked) => setPicked((current) => checked === true ? [...current, item.code] : current.filter((code) => code !== item.code))}
                  />
                  {item.name}
                </Label>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>取消</Button>
              <Button type="submit">保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LogsPage({ onError }: { onError: (value: string) => void }) {
  const [items, setItems] = useState<{ username: string; result: string; ip: string; createdAt: string }[]>([]);
  const [q, setQ] = useState("");
  function load() { return api.logs(q).then((body) => setItems(body.items)); }
  useEffect(() => { void load().catch((err) => onError(String(err))); }, []);
  return (
    <>
      <PageHead title="登录记录">
        <Input className="w-40" placeholder="账号" value={q} onChange={(event) => setQ(event.target.value)} />
        <Button variant="outline" onClick={() => void load().catch((err) => onError(err instanceof Error ? err.message : String(err)))}>查询</Button>
      </PageHead>
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号</TableHead>
              <TableHead>结果</TableHead>
              <TableHead>地址</TableHead>
              <TableHead>时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, index) => (
              <TableRow key={`${item.username}-${index}`}>
                <TableCell>{item.username}</TableCell>
                <TableCell>
                  <Badge variant={item.result === "ok" ? "secondary" : item.result === "logout" ? "outline" : "destructive"}>
                    {item.result === "ok" ? "成功" : item.result === "logout" ? "退出" : "失败"}
                  </Badge>
                </TableCell>
                <TableCell>{item.ip}</TableCell>
                <TableCell className="text-muted-foreground">{when(item.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
