const Home = async () => {
  const res = await fetch("http://localhost:8000/");
  const data = await res.text();

  return <div>Hello from Medcredit {data}</div>;
};

export const instant = false;

export default Home;
